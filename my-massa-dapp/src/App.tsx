import { JsonRPCClient, Args, SmartContract, JsonRpcProvider, Account } from "@massalabs/massa-web3";
import { useEffect, useState } from "react";
import { MassaLogo, Button, Input } from "@massalabs/react-ui-kit";
import "./App.css";
import { getWallets } from "@massalabs/wallet-provider";
//import { Wallet } from "alchemy-sdk";

const sc_addr = "AS1UGCZD9dQvjnMfwtYC8TBo1KTEhruQx3Xv5WQnNhKRt7wegZwj"; // Update with your deployed contract address
//const account = await Account.fromEnv();
//const provider = JsonRpcProvider.buildnet(account);
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
  async function createVestingSchedule() {
    console.log("Create Vesting Schedule clicked"); 
    if (!client) return;
    const account = await Account.fromEnv();
    const provider = JsonRpcProvider.buildnet(account);

       
    const contract = new SmartContract(provider, sc_addr);
    const mockTokenAddress = "0x1234567890abcdef1234567890abcdef12345678"; // Mock token address

    const args = new Args()
      .addString(mockTokenAddress)
      .addU64(BigInt(amount))
      .addU64(BigInt(lockPeriod))
      .addU64(BigInt(releaseInterval))
      .addU64(BigInt(releasePercentage));

     

    try {
      const response = await contract.call('createVestingSchedule', args.addString('data'), { maxGas: BigInt(100000) });
      console.log("Vesting scheduled:", response);
      getVestingInfo();
      getTotalVested(); 
      getLockedAmount(); 
      getReleaseSchedule(); 
    } catch (error) {
      console.error("Error scheduling vesting:", error);
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


