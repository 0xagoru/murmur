// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import '../src/MurmurLedger.sol';
interface LedgerVm {function prank(address) external;function expectRevert() external;function warp(uint) external;}
contract MockFeed {
 int256 public answer=700e8;uint public updatedAt;
 function set(int256 a,uint at) external {answer=a;updatedAt=at;}
 function latestRoundData() external view returns(uint80,int256,uint256,uint256,uint80){return (1,answer,updatedAt,updatedAt,1);}
}
contract MurmurLedgerTest {
 LedgerVm constant vm=LedgerVm(address(uint160(uint256(keccak256('hevm cheat code')))));
 MurmurLedger ledger;MockFeed feed;address scribe=address(77);bytes32 moss=bytes32('moss');bytes32 flicker=bytes32('flicker');
 function setUp() public {
  vm.warp(10 days);feed=new MockFeed();feed.set(700e8,block.timestamp);
  address[] memory feeds=new address[](1);feeds[0]=address(feed);
  ledger=new MurmurLedger(address(this),scribe,feeds);
 }
 function openAbove() internal returns(uint id){vm.prank(scribe);id=ledger.open(moss,address(feed),true,uint64(block.timestamp+1 days),bytes32('thesis'));}
 function testStrikeComesFromFeed() public {uint id=openAbove();(,,,,,,,int256 strike,,)=ledger.calls(id);require(strike==700e8);}
 function testOnlyScribeOpens() public {vm.prank(address(9));vm.expectRevert();ledger.open(moss,address(feed),true,uint64(block.timestamp+1 days),0);}
 function testUnknownFeedRejected() public {vm.prank(scribe);vm.expectRevert();ledger.open(moss,address(123),true,uint64(block.timestamp+1 days),0);}
 function testWindowBounds() public {vm.prank(scribe);vm.expectRevert();ledger.open(moss,address(feed),true,uint64(block.timestamp+10 minutes),0);vm.prank(scribe);vm.expectRevert();ledger.open(moss,address(feed),true,uint64(block.timestamp+31 days),0);}
 function testStalePriceRejected() public {feed.set(700e8,block.timestamp-2 hours);vm.prank(scribe);vm.expectRevert();ledger.open(moss,address(feed),true,uint64(block.timestamp+1 days),0);}
 function testCannotSettleEarly() public {uint id=openAbove();vm.expectRevert();ledger.settle(id);}
 function testNeedsRoundAfterExpiry() public {uint id=openAbove();vm.warp(block.timestamp+1 days+10);vm.expectRevert();ledger.settle(id);}
 function testRightCallScoresAgainstRival() public {
  uint id=openAbove();vm.prank(scribe);ledger.counter(id,flicker);
  vm.warp(block.timestamp+1 days+10);feed.set(720e8,block.timestamp);ledger.settle(id);
  (,,,,MurmurLedger.State s,,,,int256 settled,)=ledger.calls(id);
  require(s==MurmurLedger.State.Right && settled==720e8);
  require(ledger.wins(moss)==1 && ledger.losses(flicker)==1);
 }
 function testWrongCallCreditsRival() public {
  uint id=openAbove();vm.prank(scribe);ledger.counter(id,flicker);
  vm.warp(block.timestamp+1 days+10);feed.set(700e8,block.timestamp);ledger.settle(id);
  require(ledger.losses(moss)==1 && ledger.wins(flicker)==1);
 }
 function testCannotSettleTwice() public {uint id=openAbove();vm.warp(block.timestamp+1 days+10);feed.set(690e8,block.timestamp);ledger.settle(id);vm.expectRevert();ledger.settle(id);}
 function testLateSettlementIsVoid() public {
  uint id=openAbove();vm.warp(block.timestamp+3 days);feed.set(800e8,block.timestamp);ledger.settle(id);
  (,,,,MurmurLedger.State s,,,,,)=ledger.calls(id);require(s==MurmurLedger.State.Void && ledger.wins(moss)==0);
 }
 function testSelfCounterRejected() public {uint id=openAbove();vm.prank(scribe);vm.expectRevert();ledger.counter(id,moss);}
 function testCounterOnlyOnce() public {uint id=openAbove();vm.prank(scribe);ledger.counter(id,flicker);vm.prank(scribe);vm.expectRevert();ledger.counter(id,bytes32('rook'));}
 function testCounterClosesAtExpiry() public {uint id=openAbove();vm.warp(block.timestamp+1 days);vm.prank(scribe);vm.expectRevert();ledger.counter(id,flicker);}
 function testAnchorRestricted() public {vm.prank(address(9));vm.expectRevert();ledger.anchor(moss,bytes32('fees'),bytes32('h'),'uri');vm.prank(scribe);ledger.anchor(moss,bytes32('fees'),bytes32('h'),'uri');}
 function testOwnerRotatesScribe() public {ledger.setScribe(address(78));vm.prank(scribe);vm.expectRevert();ledger.anchor(moss,0,0,'');}
}
