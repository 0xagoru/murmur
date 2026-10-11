// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import '../src/MurmurLedger.sol';
import '../src/MurmurArena.sol';
import '../src/MurmurDesk.sol';
interface ArenaVm {function prank(address) external;function expectRevert() external;function warp(uint) external;function deal(address,uint) external;function etch(address,bytes calldata) external;}
contract ArenaFeed {
 int256 public answer=700e8;uint public updatedAt;
 function set(int256 a,uint at) external {answer=a;updatedAt=at;}
 function latestRoundData() external view returns(uint80,int256,uint256,uint256,uint80){return (1,answer,updatedAt,updatedAt,1);}
}
contract ArenaTest {
 ArenaVm constant vm=ArenaVm(address(uint160(uint256(keccak256('hevm cheat code')))));
 MurmurLedger ledger;MurmurArena arena;ArenaFeed feed;address scribe=address(77);
 address alice=address(0xA11CE);address bob=address(0xB0B);address carol=address(0xCA401);
 receive() external payable {}
 function setUp() public {
  vm.warp(10 days);feed=new ArenaFeed();feed.set(700e8,block.timestamp);
  address[] memory feeds=new address[](1);feeds[0]=address(feed);
  ledger=new MurmurLedger(address(this),scribe,feeds);
  arena=new MurmurArena(address(this),address(ledger));
  vm.deal(alice,10 ether);vm.deal(bob,10 ether);vm.deal(carol,10 ether);
 }
 function openCall() internal returns(uint id){vm.prank(scribe);id=ledger.open(bytes32('moss'),address(feed),true,uint64(block.timestamp+1 days),0);}
 function settleAt(uint id,int256 p) internal {vm.warp(block.timestamp+1 days+10);feed.set(p,block.timestamp);ledger.settle(id);}
 function testWinnersSplitLosers() public {
  uint id=openCall();
  vm.prank(alice);arena.back{value:1 ether/10}(id,true);
  vm.prank(carol);arena.back{value:3 ether/10}(id,true);
  vm.prank(bob);arena.back{value:2 ether/10}(id,false);
  settleAt(id,710e8);
  uint before=alice.balance;vm.prank(alice);arena.claim(id);
  // alice: 0.1 + 0.2*0.1/0.4=0.05 winnings, minus 3% of winnings
  require(alice.balance-before==0.1 ether+0.05 ether-0.0015 ether);
  vm.prank(carol);arena.claim(id);
  vm.prank(bob);vm.expectRevert();arena.claim(id);
  require(arena.fees()==0.0015 ether+0.0045 ether);
  require(address(arena).balance>=arena.fees());
  vm.prank(alice);vm.expectRevert();arena.claim(id);
 }
 function testBackingClosesHalfway() public {
  uint id=openCall();vm.warp(block.timestamp+12 hours);
  vm.prank(alice);vm.expectRevert();arena.back{value:0.01 ether}(id,true);
 }
 function testStakeBounds() public {
  uint id=openCall();
  vm.prank(alice);vm.expectRevert();arena.back{value:0.0001 ether}(id,true);
  vm.prank(alice);arena.back{value:0.4 ether}(id,true);
  vm.prank(alice);vm.expectRevert();arena.back{value:0.2 ether}(id,false);
 }
 function testOneSidedPoolRefunds() public {
  uint id=openCall();vm.prank(alice);arena.back{value:0.1 ether}(id,false);
  settleAt(id,710e8);
  uint before=alice.balance;vm.prank(alice);arena.claim(id);require(alice.balance-before==0.1 ether);
 }
 function testVoidRefunds() public {
  uint id=openCall();vm.prank(alice);arena.back{value:0.1 ether}(id,true);vm.prank(bob);arena.back{value:0.1 ether}(id,false);
  vm.warp(block.timestamp+3 days);feed.set(800e8,block.timestamp);ledger.settle(id);
  uint before=bob.balance;vm.prank(bob);arena.claim(id);require(bob.balance-before==0.1 ether);
 }
 function testAbandonedRefunds() public {
  uint id=openCall();vm.prank(alice);arena.back{value:0.1 ether}(id,true);
  vm.prank(alice);vm.expectRevert();arena.claim(id);
  vm.warp(block.timestamp+9 days);
  vm.prank(alice);arena.claim(id);
 }
 function testCannotBackSettled() public {
  uint id=openCall();settleAt(id,710e8);
  vm.prank(alice);vm.expectRevert();arena.back{value:0.01 ether}(id,true);
 }
 function testOnlyOwnerWithdrawsFees() public {
  vm.prank(alice);vm.expectRevert();arena.withdrawFees(alice);
 }
}
contract DeskTest {
 ArenaVm constant vm=ArenaVm(address(uint160(uint256(keccak256('hevm cheat code')))));
 MurmurDesk desk;address clerk=address(55);address user=address(0xBEEF);address token;
 receive() external payable {}
 function setUp() public {
  vm.warp(10 days);desk=new MurmurDesk(address(this),clerk,0.003 ether);vm.deal(user,1 ether);
  token=address(new ArenaFeed());
 }
 function testRequestAndFulfil() public {
  vm.prank(user);uint id=desk.request{value:0.003 ether}(token);
  vm.prank(clerk);desk.fulfil(id,bytes32('r'),'u');
  require(desk.earned()==0.003 ether);
  vm.prank(clerk);vm.expectRevert();desk.refund(id);
  uint before=address(this).balance;desk.withdraw(address(this));require(address(this).balance-before==0.003 ether);
 }
 function testFeeAndContractRequired() public {
  vm.prank(user);vm.expectRevert();desk.request{value:0.001 ether}(token);
  vm.prank(user);vm.expectRevert();desk.request{value:0.003 ether}(address(0x1234));
 }
 function testRequesterRefundAfterDay() public {
  vm.prank(user);uint id=desk.request{value:0.003 ether}(token);
  vm.prank(user);vm.expectRevert();desk.refund(id);
  vm.warp(block.timestamp+1 days);
  uint before=user.balance;vm.prank(user);desk.refund(id);require(user.balance-before==0.003 ether);
  require(desk.earned()==0);
 }
 function testStrangerCannotFulfil() public {
  vm.prank(user);uint id=desk.request{value:0.003 ether}(token);
  vm.prank(user);vm.expectRevert();desk.fulfil(id,bytes32('r'),'u');
 }
}
