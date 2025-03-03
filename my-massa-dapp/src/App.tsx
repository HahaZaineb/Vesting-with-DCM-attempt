import { JsonRPCClient, Args, SmartContract } from "@massalabs/massa-web3";
import { useEffect, useState } from "react";
import { MassaLogo, Button, Input, ConnectMassaWallet, useAccountStore } from "@massalabs/react-ui-kit";
import "./App.css";
import "@massalabs/react-ui-kit/src/global.css";

const sc_addr = "AS12KgV2TkhXTV9cHXr3i3gjyoALWS2uhNFz6wi5V6Upz9U838VPW";


function App() {
  const client = JsonRPCClient.buildnet();
  const {connectedAccount} = useAccountStore();  

  const [token, setToken] = useState("AS12N76WPYB3QNYKGhV2jZuQs1djdhNJLQgnm7m52pHWecvvj1fCQ");
  const [amount, setAmount] = useState("");
  const [lockPeriod, setLockPeriod] = useState("");
  const [releaseInterval, setReleaseInterval] = useState("");
  const [releasePercentage, setReleasePercentage] = useState("");
  const [vestingInfo, setVestingInfo] = useState("");
  const [totalVested, setTotalVested] = useState(0);
  const [lockedAmount, setLockedAmount] = useState(0);
  const [releaseSchedule, setReleaseSchedule] = useState<any[]>([]);

  // Fetch vesting info, total vested, and locked amount on mount
  useEffect(() => {
    getVestingInfo();
    getTotalVested();
    getLockedAmount();
    getReleaseSchedule();
  }, []);

  // Create Vesting Schedule
  async function createVestingSchedule() {
    console.log("Create Vesting Schedule clicked");
       
      const contract = new SmartContract(connectedAccount as any, sc_addr);
      const beneficiaryAddress = "AU1264Bah4q6pYLrGBh27V1b9VXL2XmnQCwMhY74HW4dxahpqxkrN";
      const args = new Args()
        .addString(beneficiaryAddress)
        .addString(token)
        .addU64(BigInt(amount))                 
        .addU64(BigInt(releaseInterval))        
        .addU64(BigInt(releasePercentage))      
        .addU64(BigInt(lockPeriod)); 
    
      const response = await contract.call("createVestingSchedule", args, {
        maxGas: BigInt(2100000),
        coins: BigInt(0),
      });

      console.log("Transaction response:", response);
      getVestingInfo(); 
    }
  
 

  // Fetch Vesting Info (Status, Amounts)
  async function getVestingInfo() {
    if (client) {
      try {
        const data = await client.getDatastoreEntry("vestingInfo", sc_addr, false);
        setVestingInfo(new TextDecoder().decode(data));
      } catch (error) {
        console.error("Error fetching vesting info:", error);
      }
    }
  }

  // Fetch Total Vested Tokens
  async function getTotalVested() {
    if (client) {
      try {
        const contract = new SmartContract(connectedAccount as any, sc_addr);

        const data = await contract.call(
          "getTotalVested",       
          new Args(),            
          { maxGas: BigInt(2100000),  coins: BigInt(0) }
        );
        setTotalVested(Number(data.toString()));
      } catch (error) {
        console.error("Error fetching total vested:", error);
      }
    }
  }

  // Fetch Locked Amount
  async function getLockedAmount() {
    if (client) {
      try {
        const contract = new SmartContract(connectedAccount as any, sc_addr);

        const data = await contract.call(
          "getLockedAmount",      
          new Args(),             
          { maxGas: BigInt(2100000), coins: BigInt(0) }
        );
        setLockedAmount(Number(data.toString()));
      } catch (error) {
        console.error("Error fetching locked amount:", error);
      }
    }
  }

  async function getReleaseSchedule() {
    if (client) {
      try {
        const contract = new SmartContract(connectedAccount as any, sc_addr);
  
        const data = await contract.call("getReleaseSchedule", new Args(), { maxGas: BigInt(2100000), coins: BigInt(0) });
        
        const resultStr = data.toString();
        console.log("Raw release schedule data:", resultStr);
        const schedule = JSON.parse(resultStr);
        setReleaseSchedule(schedule);
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
