import { JsonRPCClient, Args, SmartContract, JsonRpcProvider, Account, } from "@massalabs/massa-web3";
import { useEffect, useState } from "react";
import { MassaLogo, Button, Input, ConnectMassaWallet } from "@massalabs/react-ui-kit";
import "./App.css";
import "@massalabs/react-ui-kit/src/global.css";

const sc_addr = "AS1UGCZD9dQvjnMfwtYC8TBo1KTEhruQx3Xv5WQnNhKRt7wegZwj";


function App() {
  const client = JsonRPCClient.buildnet();

  const [token, setToken] = useState("0x1234567890abcdef1234567890abcdef12345678"); 
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
  
    try {
      const privateKey = import.meta.env.VITE_PRIVATE_KEY;
      if (!privateKey) {
        throw new Error("Private key is missing from environment variables.");
      }
  
      const account = await Account.fromPrivateKey(privateKey);
      const provider = JsonRpcProvider.buildnet(account);
      const contract = new SmartContract(provider, sc_addr);
      const mockTokenAddress = "0x1234567890abcdef1234567890abcdef12345678"; 
      const beneficiaryAddress = "AU1264Bah4q6pYLrGBh27V1b9VXL2XmnQCwMhY74HW4dxahpqxkrN"; 
      const args = new Args()
        .addString(beneficiaryAddress)
        .addString(mockTokenAddress)  
        .addU64(BigInt(amount))
        .addU64(BigInt(lockPeriod))
        .addU64(BigInt(releaseInterval))
        .addU64(BigInt(releasePercentage));
  
      const response = await contract.call("createVestingSchedule", args, {
        maxGas: BigInt(2100000),
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
      const privateKey = import.meta.env.VITE_PRIVATE_KEY;
      const account = await Account.fromPrivateKey(privateKey);
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
      const privateKey = import.meta.env.VITE_PRIVATE_KEY;
      const account = await Account.fromPrivateKey(privateKey);
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
      const privateKey = import.meta.env.VITE_PRIVATE_KEY;
      const account = await Account.fromPrivateKey(privateKey);
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
      <ConnectMassaWallet />
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