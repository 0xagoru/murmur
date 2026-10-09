// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import '@openzeppelin/contracts/token/ERC20/ERC20.sol';
import '@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol';
import '@openzeppelin/contracts/access/Ownable.sol';
import '@openzeppelin/contracts/utils/ReentrancyGuard.sol';
interface IRouter {
 function WETH() external pure returns(address);
 function swapExactETHForTokens(uint,address[] calldata,address,uint) external payable returns(uint[] memory);
 function swapExactTokensForETH(uint,uint,address[] calldata,address,uint) external returns(uint[] memory);
}
contract AgentAccount is Ownable, ReentrancyGuard {
 using SafeERC20 for IERC20;
 address public operator;
 address public immutable router;
 uint public dailyLimit;
 uint public spent;
 uint public day;
 bool public paused;
 mapping(address=>bool) public allowedTokens;
 event Trade(address indexed token,bool buy,uint input,uint output);
 event Withdrawal(address indexed asset,address indexed recipient,uint amount);
 event OperatorChanged(address indexed operator);
 event PolicyChanged(uint dailyLimit,bool paused);
 constructor(address controller,address worker,address exchange,uint limit) Ownable(controller) {operator=worker;router=exchange;dailyLimit=limit;day=block.timestamp/1 days;}
 receive() external payable {}
 modifier operating() {require(msg.sender==operator,'operator only');require(!paused,'paused');_;}
 function setOperator(address worker) external onlyOwner {operator=worker;emit OperatorChanged(worker);}
 function setPolicy(uint limit,bool stop) external onlyOwner {dailyLimit=limit;paused=stop;emit PolicyChanged(limit,stop);}
 function allowToken(address token,bool allowed) external onlyOwner {allowedTokens[token]=allowed;}
 function charge(uint amount) internal {uint today=block.timestamp/1 days;if(today!=day){day=today;spent=0;}require(amount<=dailyLimit-spent,'daily cap');spent+=amount;}
 function buy(address token,uint amount,uint minimum,uint deadline) external operating nonReentrant {
  require(allowedTokens[token] && minimum>0 && amount>0,'invalid trade');require(deadline>=block.timestamp && deadline<=block.timestamp+5 minutes,'deadline');charge(amount);
  address[] memory path=new address[](2);path[0]=IRouter(router).WETH();path[1]=token;
  uint beforeBalance=IERC20(token).balanceOf(address(this));
  IRouter(router).swapExactETHForTokens{value:amount}(minimum,path,address(this),deadline);
  emit Trade(token,true,amount,IERC20(token).balanceOf(address(this))-beforeBalance);
 }
 function sell(address token,uint amount,uint minimum,uint deadline) external operating nonReentrant {
  require(allowedTokens[token] && minimum>0 && amount>0,'invalid trade');require(deadline>=block.timestamp && deadline<=block.timestamp+5 minutes,'deadline');
  // Operator sale sizes are capped by received native value; purchases are the budgeted risk exposure.
  IERC20(token).forceApprove(router,amount);
  address[] memory path=new address[](2);path[0]=token;path[1]=IRouter(router).WETH();uint beforeBalance=address(this).balance;
  IRouter(router).swapExactTokensForETH(amount,minimum,path,address(this),deadline);
  IERC20(token).forceApprove(router,0);emit Trade(token,false,amount,address(this).balance-beforeBalance);
 }
 function withdraw(address asset,address recipient,uint amount) external onlyOwner nonReentrant {
  require(recipient!=address(0),'recipient');if(asset==address(0)){(bool ok,)=recipient.call{value:amount}('');require(ok,'transfer');}else{IERC20(asset).safeTransfer(recipient,amount);}emit Withdrawal(asset,recipient,amount);
 }
}
contract MurmurRegistry is Ownable {
 struct Resident {address account;bytes32 faction;string profile;}
 mapping(bytes32=>Resident) public residents;
 event Registered(bytes32 indexed id,address indexed account,bytes32 faction,string profile);
 event ResearchPublished(bytes32 indexed agent,bytes32 indexed room,bytes32 contentHash,string uri);
 constructor(address controller) Ownable(controller) {}
 function register(bytes32 id,address account,bytes32 faction,string calldata profile) external onlyOwner {require(residents[id].account==address(0)&&account.code.length>0,'invalid resident');residents[id]=Resident(account,faction,profile);emit Registered(id,account,faction,profile);}
 function publish(bytes32 id,bytes32 room,bytes32 contentHash,string calldata uri) external {require(msg.sender==residents[id].account || msg.sender==owner(),'not resident');emit ResearchPublished(id,room,contentHash,uri);}
}
contract MurmurCoin is ERC20 {constructor(string memory name,string memory symbol,uint supply,address creator) ERC20(name,symbol){_mint(creator,supply);}}
contract MurmurLaunchpad is ReentrancyGuard {
 using SafeERC20 for IERC20;
 uint public constant INITIAL_SUPPLY=1_000_000_000 ether;
 uint public constant INVENTORY=800_000_000 ether;
 uint public constant VIRTUAL_BNB=1 ether;
 struct Market {uint sold;uint reserve;address creator;}
 mapping(address=>Market) public markets;
 address[] public coins;
 event Launched(address indexed token,address indexed creator,string name,string symbol);
 event Exchanged(address indexed token,address indexed trader,bool buy,uint tokens,uint nativeAmount);
 function launch(string calldata name,string calldata symbol) external nonReentrant returns(address) {
  require(bytes(name).length>0 && bytes(name).length<=40 && bytes(symbol).length>0 && bytes(symbol).length<=10,'metadata');
  MurmurCoin token=new MurmurCoin(name,symbol,INITIAL_SUPPLY,address(this));
  markets[address(token)]=Market(0,0,msg.sender);coins.push(address(token));IERC20(address(token)).safeTransfer(msg.sender,INITIAL_SUPPLY-INVENTORY);emit Launched(address(token),msg.sender,name,symbol);return address(token);
 }
 function count() external view returns(uint){return coins.length;}
 function quoteBuy(address token,uint nativeAmount) public view returns(uint){Market memory m=markets[token];require(m.creator!=address(0),'unknown coin');return (INVENTORY-m.sold)*nativeAmount/(VIRTUAL_BNB+m.reserve+nativeAmount);}
 function quoteSell(address token,uint amount) public view returns(uint){Market memory m=markets[token];require(m.creator!=address(0)&&amount<=m.sold,'invalid amount');return (VIRTUAL_BNB+m.reserve)*amount/(INVENTORY-m.sold+amount);}
 function buy(address token,uint minimum,uint deadline) external payable nonReentrant {require(block.timestamp<=deadline&&msg.value>0,'invalid order');uint amount=quoteBuy(token,msg.value);require(amount>=minimum&&minimum>0,'slippage');Market storage m=markets[token];m.sold+=amount;m.reserve+=msg.value;IERC20(token).safeTransfer(msg.sender,amount);emit Exchanged(token,msg.sender,true,amount,msg.value);}
 function sell(address token,uint amount,uint minimum,uint deadline) external nonReentrant {require(block.timestamp<=deadline&&amount>0,'invalid order');uint out=quoteSell(token,amount);Market storage m=markets[token];require(out>=minimum&&minimum>0&&out<=m.reserve,'slippage or reserve');IERC20(token).safeTransferFrom(msg.sender,address(this),amount);m.sold-=amount;m.reserve-=out;(bool ok,)=msg.sender.call{value:out}('');require(ok,'transfer');emit Exchanged(token,msg.sender,false,amount,out);}
}
