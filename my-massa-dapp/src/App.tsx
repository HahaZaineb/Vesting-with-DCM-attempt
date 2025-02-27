import { JsonRPCClient, Args, SmartContract, JsonRpcProvider, Account, } from "@massalabs/massa-web3";
import { useEffect, useState } from "react";
import { MassaLogo, Button, Input } from "@massalabs/react-ui-kit";
import "./App.css";


declare global {
  interface Window {
    massa?: any;
  }
}
import { getWallets } from "@massalabs/wallet-provider";

const sc_addr = "AS1UGCZD9dQvjnMfwtYC8TBo1KTEhruQx3Xv5WQnNhKRt7wegZwj";
console.log("window.massa:", window.massa);
function checkWallet() {
  let attempts = 0;
const intervalId = setInterval(() => {
  //setTimeout(() => {
  if (!window.massa) {
    console.error("Bearby Wallet is NOT injected! Check if the extension is installed.", window.massa);
    clearInterval(intervalId);
    return true;
  }
  attempts++;
  console.log("Checking for Bearby Wallet... Attempt", attempts);

  if (attempts > 5) {
      clearInterval(intervalId);  // Stop after 5 attempts
      console.error("Bearby Wallet is not injected! Please install the extension.");
      return false;
    }
  }, 1000);
return false;
}

if (!checkWallet()) {
  console.error("Wallet check failed.");
}

async function walletExample() {
  const wallets = await getWallets();
  if (wallets.length === 0) {
      console.error("No wallets found");
      return null;
  }
  const wallet = wallets[0];
  // Connect to the wallet
  const connected = await wallet.connect();
  if (!connected) {
    console.log("Failed to connect to wallet");
    return null;
  }
  
  // Listen for account changes
  wallet.listenAccountChanges((address) => {
    console.log("Account changed:", address);
  });
  return wallet;
}
walletExample().catch(console.error);
function App() {
  const client = JsonRPCClient.buildnet();

  const [token, setToken] = useState("0x1234567890abcdef1234567890abcdef12345678");  // Mock token address
  const [amount, setAmount] = useState("");
  const [lockPeriod, setLockPeriod] = useState("");
  const [releaseInterval, setReleaseInterval] = useState("");
  const [releasePercentage, setReleasePercentage] = useState("");
  const [vestingInfo, setVestingInfo] = useState("");
  const [totalVested, setTotalVested] = useState(0);
  const [lockedAmount, setLockedAmount] = useState(0);
  const [releaseSchedule, setReleaseSchedule] = useState([]);
  

  useEffect(() => {
    getVestingInfo();
    getTotalVested();
    getLockedAmount();
    getReleaseSchedule();
    
  }, []);
  async function connectWallet() {
    if (!window.massa) {
      console.error("Bearby Wallet is NOT injected!");
      return;
    }
  
    try {
      const account = await window.massa.connect();
      console.log("Connected to Bearby Wallet:", account);
      return account;
    } catch (error) {
      console.error("Failed to connect to Bearby Wallet:", error);
    }
  }
  
  async function createVestingSchedule() {
    console.log("Create Vesting Schedule clicked");
    const connectedAccount = await connectWallet();
    if (!connectedAccount) {
      console.error("Failed to connect to Bearby Wallet");
      return;
    }
    // Check if Bearby Wallet is injected
    if (!window.massa) {
      console.error("Bearby Wallet is NOT injected! Please install the wallet extension.");
      return;
    }
  
    // Check if Bearby Wallet is connected
    if (!window.massa.isConnected) {
      console.error("Bearby Wallet is not connected.");
      return;
    }
  
    try {
      const provider = new JsonRpcProvider(window.massa, await window.massa.getProviderAccount());
  
      const contract = new SmartContract(provider, sc_addr);
      const mockTokenAddress = "0x1234567890abcdef1234567890abcdef12345678";
      const args = new Args()
        .addString(mockTokenAddress)  
        .addU64(BigInt(amount))
        .addU64(BigInt(lockPeriod))
        .addU64(BigInt(releaseInterval))
        .addU64(BigInt(releasePercentage));
  
      const response = await contract.call("createVestingSchedule", args, {
        maxGas: BigInt(2_000_000),
      });
  
      console.log("Transaction response:", response);
      getVestingInfo(); 
    } catch (error) {
      console.error("Error calling contract:", error);
    }
  }
  

  

  async function getVestingInfo() {
    if (client) {
      try {
        const data = await client.getDatastoreEntry("vesting_info", sc_addr, false);
        setVestingInfo(new TextDecoder().decode(data));
      } catch (error) {
        console.error("Error fetching vesting info:", error);
      }
    }
  }
  async function getTotalVested() {
    if (client) {
      const account = await Account.fromEnv();
      const provider = JsonRpcProvider.buildnet(account);

       
    const contract = new SmartContract(provider, sc_addr);
      try {
        const data = await contract.call(sc_addr, new Args().addString('getTotalVested'), { maxGas: BigInt(100000) });
        setTotalVested(Number(data.toString()));
      } catch (error) {
        console.error("Error fetching total vested:", error);
      }
    }
  }
  async function getLockedAmount() {
    if (client) {
      const account = await Account.fromEnv();
    const provider = JsonRpcProvider.buildnet(account);

       
    const contract = new SmartContract(provider, sc_addr);
      try {
        const data = await contract.call(sc_addr, new Args().addString('getLockedAmount'), { maxGas: BigInt(100000) });
        setLockedAmount(Number(data.toString()));
      } catch (error) {
        console.error("Error fetching locked amount:", error);
      }
    }
  }

  async function getReleaseSchedule() {
    if (client) {
      const account = await Account.fromEnv();
    const provider = JsonRpcProvider.buildnet(account);

       
    const contract = new SmartContract(provider, sc_addr);
      try {
        const data = await contract.call(sc_addr, new Args().addString('getReleaseSchedule'), { maxGas: BigInt(100000) });
        setReleaseSchedule(JSON.parse(data.toString()));
      } catch (error) {
        console.error("Error fetching release schedule:", error);
      }
    }
  }

  

  return (
    <div>
      <MassaLogo className="logo" size={100} />
      <h2>Vesting Schedule</h2>

      <Input placeholder="Token Address" value={token} onChange={(e) => setToken(e.target.value)} />
      <Input placeholder="Amount" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} />
      <Input placeholder="Lock Period (seconds)" type="number" value={lockPeriod} onChange={(e) => setLockPeriod(e.target.value)} />
      <Input placeholder="Release Interval (seconds)" type="number" value={releaseInterval} onChange={(e) => setReleaseInterval(e.target.value)} />
      <Input placeholder="Release Percentage (%)" type="number" value={releasePercentage} onChange={(e) => setReleasePercentage(e.target.value)} />

      <Button onClick={createVestingSchedule}>Create Vesting Schedule</Button>

      <h3>Vesting Info:</h3>
      <pre>{vestingInfo || "No vesting schedule found."}</pre>

      <h3>Total Vested Amount:</h3>
      <p>{totalVested} tokens</p>

      <h3>Locked Amount:</h3>
      <p>{lockedAmount} tokens</p>

      <h3>Release Schedule:</h3>
      <pre>{JSON.stringify(releaseSchedule, null, 2)}</pre>
    </div>
  );
}

export default App;


