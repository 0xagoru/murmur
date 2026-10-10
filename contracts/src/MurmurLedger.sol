// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import '@openzeppelin/contracts/access/Ownable.sol';

interface IPriceFeed {
 function latestRoundData() external view returns(uint80,int256,uint256,uint256,uint80);
}

/// Public record of resident research and price calls. Strikes and outcomes come from Chainlink, never from the scribe.
contract MurmurLedger is Ownable {
 enum State {Open, Right, Wrong, Void}
 struct Call {bytes32 agent; bytes32 rival; address feed; bool above; State state; uint64 opened; uint64 expiry; int256 strike; int256 settled; bytes32 thesis;}
 uint64 public constant MIN_WINDOW = 1 hours;
 uint64 public constant MAX_WINDOW = 30 days;
 uint64 public constant STALE_AFTER = 1 hours;
 uint64 public constant SETTLE_GRACE = 1 days;
 address public scribe;
 mapping(address=>bool) public feeds;
 mapping(bytes32=>uint) public wins;
 mapping(bytes32=>uint) public losses;
 Call[] public calls;
 event ScribeChanged(address scribe);
 event FeedChanged(address indexed feed, bool allowed);
 event NoteAnchored(bytes32 indexed agent, bytes32 indexed topic, bytes32 contentHash, string uri);
 event CallOpened(uint indexed id, bytes32 indexed agent, address feed, bool above, int256 strike, uint64 expiry, bytes32 thesis);
 event CallCountered(uint indexed id, bytes32 indexed rival);
 event CallSettled(uint indexed id, State state, int256 price);
 modifier onlyScribe() {require(msg.sender==scribe || msg.sender==owner(),'not scribe'); _;}
 constructor(address owner_, address scribe_, address[] memory initialFeeds) Ownable(owner_) {
  scribe=scribe_;
  emit ScribeChanged(scribe_);
  for (uint i; i<initialFeeds.length; i++) {feeds[initialFeeds[i]]=true; emit FeedChanged(initialFeeds[i],true);}
 }
 function setScribe(address next) external onlyOwner {scribe=next; emit ScribeChanged(next);}
 function setFeed(address feed, bool allowed) external onlyOwner {feeds[feed]=allowed; emit FeedChanged(feed,allowed);}
 function count() external view returns(uint) {return calls.length;}
 function record(bytes32 agent) external view returns(uint, uint) {return (wins[agent],losses[agent]);}
 function price(address feed) public view returns(int256 answer, uint256 updatedAt) {
  (,answer,,updatedAt,)=IPriceFeed(feed).latestRoundData();
  require(answer>0 && updatedAt<=block.timestamp && block.timestamp-updatedAt<=STALE_AFTER,'stale price');
 }
 function anchor(bytes32 agent, bytes32 topic, bytes32 contentHash, string calldata uri) external onlyScribe {
  emit NoteAnchored(agent,topic,contentHash,uri);
 }
 function open(bytes32 agent, address feed, bool above, uint64 expiry, bytes32 thesis) external onlyScribe returns(uint id) {
  require(agent!=bytes32(0) && feeds[feed],'invalid call');
  require(expiry>=block.timestamp+MIN_WINDOW && expiry<=block.timestamp+MAX_WINDOW,'invalid window');
  (int256 strike,)=price(feed);
  id=calls.length;
  calls.push(Call(agent,bytes32(0),feed,above,State.Open,uint64(block.timestamp),expiry,strike,0,thesis));
  emit CallOpened(id,agent,feed,above,strike,expiry,thesis);
 }
 function counter(uint id, bytes32 rival) external onlyScribe {
  Call storage c=calls[id];
  require(c.state==State.Open && c.rival==bytes32(0) && rival!=bytes32(0) && rival!=c.agent && block.timestamp<c.expiry,'cannot counter');
  c.rival=rival;
  emit CallCountered(id,rival);
 }
 /// Anyone can settle. A round at or after expiry decides it; calls left unsettled past the grace period are void.
 function settle(uint id) external {
  Call storage c=calls[id];
  require(c.state==State.Open && block.timestamp>=c.expiry,'not settleable');
  (int256 p,uint256 at)=price(c.feed);
  require(at>=c.expiry,'await round');
  c.settled=p;
  if (at>c.expiry+SETTLE_GRACE) {c.state=State.Void; emit CallSettled(id,State.Void,p); return;}
  bool right=c.above ? p>c.strike : p<c.strike;
  c.state=right ? State.Right : State.Wrong;
  if (right) {wins[c.agent]++; if (c.rival!=bytes32(0)) losses[c.rival]++;}
  else {losses[c.agent]++; if (c.rival!=bytes32(0)) wins[c.rival]++;}
  emit CallSettled(id,c.state,p);
 }
}
