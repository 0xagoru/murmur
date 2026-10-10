// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import '../src/Murmur.sol';
interface Vm {function deal(address,uint) external;function prank(address) external;function expectRevert() external;function warp(uint) external;}
contract MockRouter {
 MurmurCoin public token;
 constructor(){token=new MurmurCoin('test','T',1e30,address(this));}
 function WETH() external pure returns(address){return address(1);}
 function getAmountsOut(uint amount,address[] calldata path) external view returns(uint[] memory out){out=new uint[](2);out[0]=amount;out[1]=path[1]==address(token)?amount*1000:amount/1000;}
 function swapExactETHForTokens(uint minimum,address[] calldata,address to,uint) external payable returns(uint[] memory out){uint amount=msg.value*1000;require(amount>=minimum);token.transfer(to,amount);out=new uint[](2);out[1]=amount;}
 function swapExactTokensForETH(uint amount,uint minimum,address[] calldata,address to,uint) external returns(uint[] memory out){token.transferFrom(msg.sender,address(this),amount);uint value=amount/1000;require(value>=minimum);(bool ok,)=to.call{value:value}('');require(ok);out=new uint[](2);out[1]=value;}
 receive() external payable {}
}
contract MurmurTest {
 Vm constant vm=Vm(address(uint160(uint256(keccak256('hevm cheat code')))));
 MurmurLaunchpad launchpad;MockRouter router;AgentAccount account;address worker=address(42);address tokenAddress;
 function setUp() public {vm.deal(address(this),100 ether);launchpad=new MurmurLaunchpad();router=new MockRouter();account=new AgentAccount(address(this),worker,address(router),0.01 ether);vm.deal(address(account),1 ether);tokenAddress=address(router.token());account.allowToken(tokenAddress,true);}
 receive() external payable {}
 function testCoinSupplyAndAllocation() public {address t=launchpad.launch('moss','MOSS');require(IERC20(t).totalSupply()==1e9 ether);require(IERC20(t).balanceOf(address(this))==2e8 ether);require(IERC20(t).balanceOf(address(launchpad))==8e8 ether);}
 function testCurveRoundTripReserves() public {address t=launchpad.launch('moss','MOSS');uint beforeBalance=address(this).balance;uint q=launchpad.quoteBuy(t,0.01 ether);launchpad.buy{value:0.01 ether}(t,q,block.timestamp);IERC20(t).approve(address(launchpad),q);uint out=launchpad.quoteSell(t,q);launchpad.sell(t,q,out,block.timestamp);require(address(this).balance<=beforeBalance);require(beforeBalance-address(this).balance<10);}
 function testCurveSlippageReverts() public {address t=launchpad.launch('moss','MOSS');vm.expectRevert();launchpad.buy{value:0.01 ether}(t,1e30,block.timestamp);}
 function testExpiredCurveOrder() public {address t=launchpad.launch('moss','MOSS');vm.warp(100);vm.expectRevert();launchpad.buy{value:0.01 ether}(t,1,99);}
 function testUnknownTokenRejected() public {vm.expectRevert();launchpad.buy{value:0.01 ether}(address(123),1,block.timestamp);}
 function testOperatorCannotWithdraw() public {vm.prank(worker);vm.expectRevert();account.withdraw(address(0),worker,1);}
 function testDailyCapEnforced() public {vm.prank(worker);account.buy(tokenAddress,0.009 ether,1,block.timestamp);vm.prank(worker);vm.expectRevert();account.buy(tokenAddress,0.002 ether,1,block.timestamp);}
 function testCapResetsNextDay() public {vm.prank(worker);account.buy(tokenAddress,0.01 ether,1,block.timestamp);vm.warp(block.timestamp+1 days);vm.prank(worker);account.buy(tokenAddress,0.01 ether,1,block.timestamp);require(account.spent()==0.01 ether);}
 function testPauseStopsOperator() public {account.setPolicy(0.01 ether,true);vm.prank(worker);vm.expectRevert();account.buy(tokenAddress,0.001 ether,1,block.timestamp);}
 function testUnapprovedTokenRejected() public {vm.prank(worker);vm.expectRevert();account.buy(address(123),0.001 ether,1,block.timestamp);}
 function testOperatorRevocation() public {account.setOperator(address(43));vm.prank(worker);vm.expectRevert();account.buy(tokenAddress,0.001 ether,1,block.timestamp);}
 function testRegistryCannotOverwrite() public {MurmurRegistry r=new MurmurRegistry(address(this));r.register(bytes32('moss'),address(account),bytes32('patient'),'uri');vm.expectRevert();r.register(bytes32('moss'),address(account),bytes32('patient'),'uri');}
 function testResearchRestricted() public {MurmurRegistry r=new MurmurRegistry(address(this));vm.prank(worker);vm.expectRevert();r.publish(bytes32('moss'),bytes32('room'),bytes32('hash'),'uri');}
}
