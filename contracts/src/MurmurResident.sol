// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import './Murmur.sol';

/// Owner funds this vault separately from the resident's trading account.
contract InferenceCredit is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;
    IERC20 public immutable token;
    address public immutable beneficiary;
    address public worker;
    uint public dailyLimit;
    uint public spent;
    uint public reserved;
    uint public day;
    bool public paused;
    uint public constant MAX_CALL = 0.05 ether; // BSC USDT has 18 decimals.
    struct Invoice { uint amount; uint opened; bool settled; }
    mapping(bytes32 => Invoice) public invoices;
    event Reserved(bytes32 indexed invoice, uint amount);
    event Settled(bytes32 indexed invoice, uint cost);
    event Released(bytes32 indexed invoice);
    constructor(address controller,address operator,address asset,address recipient,uint limit) Ownable(controller) {
        require(operator!=address(0) && recipient!=address(0),'address');
        token=IERC20(asset);beneficiary=recipient;worker=operator;dailyLimit=limit;day=block.timestamp/1 days;
    }
    modifier operating() {require(msg.sender==worker,'worker only');require(!paused,'paused');_;}
    function available() public view returns(uint) {return token.balanceOf(address(this))-reserved;}
    function setPolicy(uint limit,bool stop) external onlyOwner {dailyLimit=limit;paused=stop;}
    function setWorker(address operator) external onlyOwner {worker=operator;}
    function withdraw(uint amount) external onlyOwner nonReentrant {require(amount<=available(),'reserved credit');token.safeTransfer(owner(),amount);}
    function reserve(bytes32 id,uint amount) external operating {
        require(invoices[id].opened==0 && amount>0 && amount<=MAX_CALL,'invoice');
        uint today=block.timestamp/1 days;if(today!=day){day=today;spent=0;}
        require(spent+amount<=dailyLimit && amount<=available(),'credit or daily cap');
        spent+=amount;reserved+=amount;invoices[id]=Invoice(amount,block.timestamp,false);emit Reserved(id,amount);
    }
    // Pausing blocks new requests; a completed request may still settle its reservation.
    function settle(bytes32 id,uint cost) external nonReentrant {
        require(msg.sender==worker,'worker only');Invoice storage i=invoices[id];
        require(i.opened>0 && !i.settled && cost<=i.amount,'invoice');
        i.settled=true;reserved-=i.amount;
        if(i.opened/1 days==block.timestamp/1 days && day==block.timestamp/1 days) spent-=i.amount-cost;
        if(cost>0) token.safeTransfer(beneficiary,cost);emit Settled(id,cost);
    }
    function release(bytes32 id) external onlyOwner {
        Invoice storage i=invoices[id];require(i.opened>0 && !i.settled && block.timestamp>=i.opened+1 days,'pending invoice');
        i.settled=true;reserved-=i.amount;emit Released(id);
    }
}

contract MurmurResident is AgentAccount {
    InferenceCredit public immutable credit;
    constructor(address controller,address worker,address exchange,address usdt,address recipient,uint tradeLimit,uint inferenceLimit)
        AgentAccount(controller,worker,exchange,tradeLimit) {
        allowedTokens[usdt]=true;
        credit=new InferenceCredit(controller,worker,usdt,recipient,inferenceLimit);
    }
}
