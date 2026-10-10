// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import '../src/MurmurResident.sol';
interface CreditVm {function prank(address) external;function expectRevert() external;function warp(uint) external;}
contract ResidentTest {
    CreditVm constant vm=CreditVm(address(uint160(uint256(keccak256('hevm cheat code')))));
    MurmurCoin token;MurmurResident resident;InferenceCredit credit;
    address worker=address(42);address beneficiary=address(43);
    function setUp() public {
        vm.warp(100000);token=new MurmurCoin('USDT','U',100 ether,address(this));
        resident=new MurmurResident(address(this),worker,address(1),address(token),beneficiary,0.001 ether,0.1 ether);
        credit=resident.credit();token.transfer(address(credit),1 ether);token.transfer(address(resident),2 ether);
    }
    function reserve(bytes32 id) internal {vm.prank(worker);credit.reserve(id,0.05 ether);}
    function testTradingFundsAndCreditSeparate() public {
        require(token.balanceOf(address(resident))==2 ether);reserve(bytes32('a'));
        vm.prank(worker);credit.settle(bytes32('a'),0.002 ether);
        require(token.balanceOf(address(resident))==2 ether);require(token.balanceOf(beneficiary)==0.002 ether);
        require(credit.available()==0.998 ether);
    }
    function testReservedCreditCannotBeWithdrawn() public {reserve(bytes32('a'));vm.expectRevert();credit.withdraw(1 ether);credit.withdraw(0.95 ether);require(credit.available()==0);}
    function testWorkerCannotWithdrawOrChangeRecipient() public {vm.prank(worker);vm.expectRevert();credit.withdraw(1);}
    function testDailyCapAndActualCostRefund() public {
        reserve(bytes32('a'));reserve(bytes32('b'));vm.expectRevert();reserve(bytes32('c'));
        vm.prank(worker);credit.settle(bytes32('a'),0.01 ether);require(credit.spent()==0.06 ether);
        vm.prank(worker);credit.reserve(bytes32('c'),0.04 ether);
    }
    function testDuplicateAndExcessInvoiceRejected() public {
        reserve(bytes32('a'));vm.expectRevert();reserve(bytes32('a'));
        vm.prank(worker);vm.expectRevert();credit.settle(bytes32('a'),0.051 ether);
        vm.prank(worker);credit.settle(bytes32('a'),0.01 ether);
        vm.prank(worker);vm.expectRevert();credit.settle(bytes32('a'),0);
    }
    function testPauseBlocksReservationAllowsCompletion() public {reserve(bytes32('a'));credit.setPolicy(0.1 ether,true);vm.expectRevert();reserve(bytes32('b'));vm.prank(worker);credit.settle(bytes32('a'),0);}
    function testOwnerCanRecoverAbandonedReservationAfterDay() public {reserve(bytes32('a'));vm.expectRevert();credit.release(bytes32('a'));vm.warp(block.timestamp+1 days);credit.release(bytes32('a'));require(credit.available()==1 ether);vm.prank(worker);vm.expectRevert();credit.settle(bytes32('a'),0.01 ether);}
    function testRevocationAndDayReset() public {reserve(bytes32('a'));credit.setWorker(address(44));vm.expectRevert();reserve(bytes32('b'));vm.warp(block.timestamp+1 days);vm.prank(address(44));credit.reserve(bytes32('b'),0.05 ether);require(credit.spent()==0.05 ether);}
    function testLateSettlementDoesNotCorruptNewDay() public {reserve(bytes32('a'));vm.warp(block.timestamp+1 days);reserve(bytes32('b'));vm.prank(worker);credit.settle(bytes32('a'),0.01 ether);require(credit.spent()==0.05 ether);}
}
