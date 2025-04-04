import {
  Args,
  Mas,
  MRC20,
  OperationStatus,
  parseUnits,
  SmartContract,
} from '@massalabs/massa-web3';
import { useEffect, useState } from 'react';
import {
  MassaLogo,
  Button,
  Input,
  ConnectMassaWallet,
  useAccountStore,
} from '@massalabs/react-ui-kit';
import './App.css';
import '@massalabs/react-ui-kit/src/global.css';



const sc_addr = "AS12gqgHdGxAft1hBwqxHy7UqRpzrCuiotTJsf5qgJehjHXDJynBw";


function App() {
  const [beneficiary, setBeneficiary] = useState('AU1264Bah4q6pYLrGBh27V1b9VXL2XmnQCwMhY74HW4dxahpqxkrN');  

  const [token, setToken] = useState(
    'AS12N76WPYB3QNYKGhV2jZuQs1djdhNJLQgnm7m52pHWecvvj1fCQ',
  );
  const [amount, setAmount] = useState('');
  const [lockPeriod, setLockPeriod] = useState('');
  const [releaseInterval, setReleaseInterval] = useState('');
  const [releasePercentage, setReleasePercentage] = useState('');
  const [vestingInfo, setVestingInfo] = useState<number | null>(null);
  const [totalVested, setTotalVested] = useState(0);
  const [lockedAmount, setLockedAmount] = useState(0);
  const [releaseSchedule, setReleaseSchedule] = useState<any[]>([]);
  const [deferredCallId, setDeferredCallId] = useState<string | null>(null);
  const { connectedAccount } = useAccountStore();

  useEffect(() => {
    getVestingInfo();
    getTotalVested();
    getLockedAmount();
    getReleaseSchedule();
  }, []);
  async function createVestingSchedule() {
    console.log('Create Vesting Schedule clicked');

    if (!connectedAccount) {
      console.error('No connected account');
      return;
    }

    try {
      const tokenContract = new MRC20(connectedAccount, token);

      const increaseAllownaceOperation = await tokenContract.increaseAllowance(
        sc_addr,
        parseUnits(amount, 6),
      );

      const increaseAllownaceOperationStatus =
        await increaseAllownaceOperation.waitSpeculativeExecution();

      if (
        increaseAllownaceOperationStatus === OperationStatus.SpeculativeSuccess
      ) {
        console.log('Increase allowance successful');
      } else {
        console.error('Increase allowance failed');
        const events = await increaseAllownaceOperation.getSpeculativeEvents();

        console.log('Events:', events);
        return;
      }

      const contract = new SmartContract(connectedAccount as any, sc_addr);
     // const beneficiaryAddress = connectedAccount.address;
      const args = new Args()
        .addString(beneficiary)
        .addString(token)
        .addU64(parseUnits(amount, 6))
        .addU64(BigInt(lockPeriod))         
        .addU64(BigInt(releaseInterval))     
        .addU64(BigInt(releasePercentage)); 

      const response = await contract.call('createVestingSchedule', args, {
        coins: Mas.fromString('0'),
      });

      console.log('Transaction response:', response);

      const status = await response.waitSpeculativeExecution();
      console.log('Transaction status:', status);

      const events = await response.getSpeculativeEvents();

      console.log('Events:', events);

      if (status === OperationStatus.SpeculativeSuccess) {
        console.log('Transaction successful');
      } else {
        console.error('Transaction failed');
        return;
      }

      setDeferredCallId(response.toString());
      getVestingInfo();
    } catch (error) {
      console.error('Error creating vesting schedule:', error);
    }
  }

     async function getVestingInfo() {
      const contract = new SmartContract(connectedAccount as any, sc_addr);
      try {
          const result = await contract.read(
              "getVestingSchedule", 
              new Args(), 
              { maxGas: BigInt(2100000),
                coins: BigInt(0), } 
          );
  
          const decodedResult = result.value; 
          console.log("Vesting Info:", decodedResult);
      } catch (error) {
          console.error("Error fetching vesting info:", error);
      }
  }
  
  // Fetch Total Vested Tokens
  async function getTotalVested() {
    const contract = new SmartContract(connectedAccount as any, sc_addr);
      try {
        const result = await contract.read(
          "getTotalVested", 
          new Args(), 
          { maxGas: BigInt(5100000),
            coins: BigInt(0), } 
      );

      const decodedResult = result.value; 
      
      console.log("Total Vested", decodedResult);
      } catch (error) {
        console.error("Error fetching total vested:", error);
      }
    }
  
  async function getLockedAmount() {
    
      try {
        const contract = new SmartContract(connectedAccount as any, sc_addr);

        const data = await contract.read(
          "getLockedAmount",      
          new Args(),             
          { maxGas: BigInt(2100000), coins: BigInt(0) }
        );
        const decodedResult = data.value;
        console.log("Locked Amount:", decodedResult);
      } catch (error) {
        console.error("Error fetching locked amount:", error);
      }    
  }

  async function getReleaseSchedule() {
    
      try {
        const contract = new SmartContract(connectedAccount as any, sc_addr);
  
        const data = await contract.read("getReleaseSchedule", new Args(), { maxGas: BigInt(2100000), coins: BigInt(0) });
        const decodedResult = data.value;
        console.log("Release Schedule:", decodedResult);
      } 
      
      
      catch (error) {
        console.error("Error fetching release schedule:", error);
      }
    }
  
  

  return (
    <div>
      <MassaLogo className="logo" size={100} />
      <ConnectMassaWallet />
      <h2>Vesting Schedule</h2>
      <Input placeholder="Beneficiary Address" value={beneficiary} onChange={(e) => setBeneficiary(e.target.value)} />
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
