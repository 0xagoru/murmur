// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import '@openzeppelin/contracts/access/Ownable.sol';
import '@openzeppelin/contracts/utils/ReentrancyGuard.sol';

interface ILedgerCalls {
 function calls(uint id) external view returns(bytes32 agent, bytes32 rival, address feed, bool above, uint8 state, uint64 opened, uint64 expiry, int256 strike, int256 settled, bytes32 thesis);
}

/// Visitors back a side of a MurmurLedger price call. The ledger settles from Chainlink; this contract only reads its result.
/// Backing closes halfway through the call window. Winners split the losing side pro rata, minus a fee on winnings.
contract MurmurArena is Ownable, ReentrancyGuard {
 ILedgerCalls public immutable ledger;
 uint public constant MIN_STAKE = 0.001 ether;
 uint public constant MAX_STAKE = 0.5 ether;
 uint16 public constant FEE_BPS = 300;
 /// A ledger call still open this long after expiry can be refunded.
 uint64 public constant ABANDON_AFTER = 7 days;
 struct Pool {uint128 right; uint128 wrong;}
 mapping(uint=>Pool) public pools;
 mapping(uint=>mapping(address=>uint)) public onRight;
 mapping(uint=>mapping(address=>uint)) public onWrong;
 mapping(uint=>mapping(address=>bool)) public claimed;
 uint public fees;
 event Backed(uint indexed id, address indexed backer, bool agentRight, uint amount);
 event Claimed(uint indexed id, address indexed backer, uint payout, uint fee);
 event FeesWithdrawn(address to, uint amount);
 constructor(address owner_, address ledger_) Ownable(owner_) {ledger=ILedgerCalls(ledger_);}

 function closesAt(uint id) public view returns(uint64) {
  (,,,,,uint64 opened,uint64 expiry,,,)=ledger.calls(id);
  return opened+(expiry-opened)/2;
 }

 function back(uint id, bool agentRight) external payable nonReentrant {
  (bytes32 agent,,,,uint8 state,uint64 opened,uint64 expiry,,,)=ledger.calls(id);
  require(agent!=bytes32(0) && state==0,'call not open');
  require(block.timestamp<opened+(expiry-opened)/2,'backing closed');
  uint total=onRight[id][msg.sender]+onWrong[id][msg.sender]+msg.value;
  require(msg.value>=MIN_STAKE && total<=MAX_STAKE,'stake out of range');
  Pool storage p=pools[id];
  if (agentRight) {onRight[id][msg.sender]+=msg.value; p.right+=uint128(msg.value);}
  else {onWrong[id][msg.sender]+=msg.value; p.wrong+=uint128(msg.value);}
  emit Backed(id,msg.sender,agentRight,msg.value);
 }

 /// Returns (payout, fee) for a backer. Refunds when the call is void, abandoned, or one side was empty.
 function quote(uint id, address backer) public view returns(uint payout, uint fee, bool ready) {
  (,,,,uint8 state,,uint64 expiry,,,)=ledger.calls(id);
  uint r=onRight[id][backer]; uint w=onWrong[id][backer];
  Pool memory p=pools[id];
  if (state==0) {
   if (block.timestamp>expiry+ABANDON_AFTER) return (r+w,0,true);
   return (0,0,false);
  }
  if (state==3 || p.right==0 || p.wrong==0) return (r+w,0,true);
  (uint stake,uint winPool,uint losePool)=state==1 ? (r,uint(p.right),uint(p.wrong)) : (w,uint(p.wrong),uint(p.right));
  if (stake==0) return (0,0,true);
  uint winnings=stake*losePool/winPool;
  fee=winnings*FEE_BPS/10000;
  payout=stake+winnings-fee;
  ready=true;
 }

 function claim(uint id) external nonReentrant {
  require(!claimed[id][msg.sender],'claimed');
  (uint payout,uint fee,bool ready)=quote(id,msg.sender);
  require(ready && payout>0,'nothing to claim');
  claimed[id][msg.sender]=true;
  fees+=fee;
  (bool ok,)=msg.sender.call{value:payout}('');
  require(ok,'transfer failed');
  emit Claimed(id,msg.sender,payout,fee);
 }

 function withdrawFees(address to) external onlyOwner {
  uint amount=fees; fees=0;
  (bool ok,)=to.call{value:amount}('');
  require(ok,'transfer failed');
  emit FeesWithdrawn(to,amount);
 }
}
