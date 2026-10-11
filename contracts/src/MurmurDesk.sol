// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import '@openzeppelin/contracts/access/Ownable.sol';
import '@openzeppelin/contracts/utils/ReentrancyGuard.sol';

/// Paid research requests. Fees stay escrowed until the clerk publishes the report hash; unanswered requests can be refunded.
contract MurmurDesk is Ownable, ReentrancyGuard {
 enum State {Open, Fulfilled, Refunded}
 struct Request {address requester; address token; uint96 paid; State state; uint64 created; bytes32 report;}
 uint64 public constant REFUND_AFTER = 1 days;
 uint public fee;
 address public clerk;
 uint public earned;
 Request[] public requests;
 event Requested(uint indexed id, address indexed requester, address indexed token, uint paid);
 event Fulfilled(uint indexed id, bytes32 reportHash, string uri);
 event Refunded(uint indexed id, uint amount);
 event FeeChanged(uint fee);
 event ClerkChanged(address clerk);
 constructor(address owner_, address clerk_, uint fee_) Ownable(owner_) {clerk=clerk_; fee=fee_; emit ClerkChanged(clerk_); emit FeeChanged(fee_);}
 modifier onlyClerk() {require(msg.sender==clerk || msg.sender==owner(),'not clerk'); _;}
 function count() external view returns(uint) {return requests.length;}
 function setFee(uint next) external onlyOwner {fee=next; emit FeeChanged(next);}
 function setClerk(address next) external onlyOwner {clerk=next; emit ClerkChanged(next);}

 function request(address token) external payable returns(uint id) {
  require(token!=address(0) && token.code.length>0,'not a contract');
  require(msg.value>=fee && msg.value<=type(uint96).max,'fee');
  id=requests.length;
  requests.push(Request(msg.sender,token,uint96(msg.value),State.Open,uint64(block.timestamp),bytes32(0)));
  emit Requested(id,msg.sender,token,msg.value);
 }

 function fulfil(uint id, bytes32 reportHash, string calldata uri) external onlyClerk {
  Request storage r=requests[id];
  require(r.state==State.Open && reportHash!=bytes32(0),'not open');
  r.state=State.Fulfilled; r.report=reportHash;
  earned+=r.paid;
  emit Fulfilled(id,reportHash,uri);
 }

 /// The clerk can refund at any time; the requester can after a day without a report.
 function refund(uint id) external nonReentrant {
  Request storage r=requests[id];
  require(r.state==State.Open,'not open');
  require(msg.sender==clerk || msg.sender==owner() || (msg.sender==r.requester && block.timestamp>=r.created+REFUND_AFTER),'not yet');
  r.state=State.Refunded;
  (bool ok,)=r.requester.call{value:r.paid}('');
  require(ok,'transfer failed');
  emit Refunded(id,r.paid);
 }

 function withdraw(address to) external onlyOwner nonReentrant {
  uint amount=earned; earned=0;
  (bool ok,)=to.call{value:amount}('');
  require(ok,'transfer failed');
 }
}
