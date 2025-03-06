import {
  Context,
  Storage,
  Address,
  generateEvent,
  deferredCallRegister,
  findCheapestSlot,
  deferredCallCancel,
  deferredCallExists
} from '@massalabs/massa-as-sdk';
import {
  Args,
  stringToBytes,
  u64ToBytes,
  Serializable,
  Result,
} from '@massalabs/as-types';
import {
  cancelCall,
  NEXT_CALL_ID_KEY,
  registerCall,
  TASK_COUNT_KEY,
} from '../internals';
import { MRC20Wrapper } from '@massalabs/sc-standards/assembly/contracts/MRC20/wrapper';
import { MRC20 } from '@massalabs/sc-standards';
import { u256 } from 'as-bignum/assembly';

const VESTING_INFO_KEY = stringToBytes('vestingInfo');

export { processTask } from '../internals';

class VestingSchedule implements Serializable {
  constructor(
    public beneficiary: Address = new Address(''),
    public token: Address = new Address(''),
    public totalAmount: u64 = 0,
    public amountClaimed: u64 = 0,
    public lockPeriod: u64 = 0,
    public releaseSchedule: Array<u64> = [],
    public releaseInterval: u64 = 0,
  ) {}

  serialize(): StaticArray<u8> {
    return new Args()
      .add(this.beneficiary)
      .add(this.token)
      .add(this.totalAmount)
      .add(this.amountClaimed)
      .add(this.lockPeriod)
      .add(this.releaseSchedule)
      .add(this.releaseInterval)
      .serialize();
  }

  deserialize(data: StaticArray<u8>, offset: u64 = 0): Result<i32> {
    const args = new Args(data, i32(offset));

    this.beneficiary = args
      .nextSerializable<Address>()
      .expect('Failed to deserialize beneficiary.');
    this.token = args
      .nextSerializable<Address>()
      .expect('Failed to deserialize token.');
    this.totalAmount = args
      .nextU64()
      .expect('Failed to deserialize totalAmount.');
    this.amountClaimed = args
      .nextU64()
      .expect('Failed to deserialize amountClaimed.');
    this.lockPeriod = args
      .nextU64()
      .expect('Failed to deserialize lockPeriod.');
      this.releaseInterval = args
      .nextU64()
      .expect('Failed to deserialize releaseInterval.'); 
    const releaseScheduleStrings = args
      .nextStringArray()
      .expect('Failed to deserialize releaseSchedule.');
    const releaseScheduleLength = args
      .nextU32()
      .expect('Failed to deserialize releaseSchedule length.');
    this.releaseSchedule = new Array<u64>(releaseScheduleLength);
    for (let i = 0; i < i32(releaseScheduleLength); i++) {
      this.releaseSchedule[i] = args
        .nextU64()
        .expect(`Failed to deserialize releaseSchedule at index ${i}.`);
    }

    return new Result(args.offset);
  }
}

export function constructor(binArgs: StaticArray<u8>): void {
  assert(Context.isDeployingContract());

  const args = new Args(binArgs);
  const period = args.nextU64().expect('Unable to decode period');

  Storage.set(TASK_COUNT_KEY, u64ToBytes(0));
  // registerCall(period);
}

export function createVestingSchedule(binArgs: StaticArray<u8>): void {
  const args = new Args(binArgs);
  const beneficiary = new Address(
    args.nextString().expect('Missing beneficiary address'),
  );
  const token = new Address(args.nextString().expect('Missing token address'));
  const totalAmount = args.nextU64().expect('Missing total amount');
  const releaseInterval = args.nextU64().expect('Missing release interval');
  const releasePercentage = args.nextU64().expect('Missing release percentage');
  const startPeriod = Context.currentPeriod() + args.nextU64().expect('Missing lock period');

  
  const vestingSchedule = new VestingSchedule(
    beneficiary,
    token,
    totalAmount,
    0,
    startPeriod,
    [startPeriod, releasePercentage, 0], // Fix order: [releaseTime, releasePercentage, callId]
    releaseInterval
  );
  


  const tokenContract = new MRC20Wrapper(token);

  // Caller is the one that initializes the transaction
  const callerAddress = Context.caller();
  // Callee is this smart contract
  const calleeAddress = Context.callee();

  // Get allowance from user to this contract
  const allowance = tokenContract.allowance(callerAddress, calleeAddress);

  // Make sure user has enough allowance
  assert(allowance.toU64() >= totalAmount, 'Insufficient allowance');

  // Transfer tokens from user to this contract
  tokenContract.transferFrom(
    callerAddress,
    calleeAddress,
    u256.fromU64(totalAmount),
  );
  generateEvent(`Locking ${totalAmount} tokens for vesting`);

  // Schedule first release
  const releaseArgs = new Args().add(beneficiary).serialize();
  const releaseSlot = findCheapestSlot(
    startPeriod,
    startPeriod + 10,
    100000,
    releaseArgs.length,
  );
  const callId = deferredCallRegister(
  Context.callee().toString(),
  'releaseVestedTokens',
  releaseSlot,
  100000,
  releaseArgs,
  1_000_000_000 // Provide 1 MAS for execution
);

  generateEvent(`Deferred call registered at slot ${releaseSlot} with ID: ${callId}`);
  const callExists = deferredCallExists(callId);
  generateEvent(`Deferred call registered? ${callExists}`);

  vestingSchedule.releaseSchedule[2] = u64(parseInt(callId));

  Storage.set(VESTING_INFO_KEY, vestingSchedule.serialize());
}


export function releaseVestedTokens(binArgs: StaticArray<u8>): void {
  generateEvent('releaseVestedTokens function called');

  const args = new Args(binArgs);
  const beneficiary = new Address(
    args.nextString().expect('Missing beneficiary address')
  );

  // Load vesting schedule from storage
  let storedData = Storage.get(VESTING_INFO_KEY);
  if (storedData.length == 0) {
    generateEvent('No vesting schedule found');
    return;
  }
  let vestingSchedule = new VestingSchedule();
  vestingSchedule.deserialize(storedData);

  // Debug current period and next release period
  generateEvent(
    `Current Period: ${Context.currentPeriod()}, Scheduled Release: ${vestingSchedule.releaseSchedule[0]}`
  );

  // Check if the release time has arrived
  if (Context.currentPeriod() < vestingSchedule.releaseSchedule[0]) {
    generateEvent('Not yet time for release');
    return;
  }

  // Ensure tokens are still available for release
  if (vestingSchedule.amountClaimed >= vestingSchedule.totalAmount) {
    generateEvent('All tokens already released');
    return;
  }

  // Calculate the amount to release
  let amountToRelease = (vestingSchedule.totalAmount * vestingSchedule.releaseSchedule[1]) / 100;
  let remainingAmount = vestingSchedule.totalAmount - vestingSchedule.amountClaimed;
  if (amountToRelease > remainingAmount) {
    amountToRelease = remainingAmount;
  }

  generateEvent(`Releasing ${amountToRelease} tokens to ${beneficiary.toString()}`);

  // Ensure the contract has enough balance
  const tokenContract = new MRC20Wrapper(vestingSchedule.token);
  const contractBalance = tokenContract.balanceOf(Context.callee());
  generateEvent(`Contract balance: ${contractBalance.toU64()}`);

  assert(contractBalance.toU64() >= amountToRelease, 'Contract does not have enough tokens');

  // Transfer tokens to beneficiary
  tokenContract.transfer(
    vestingSchedule.beneficiary,
    u256.fromU64(amountToRelease)
  );

  generateEvent(`Successfully transferred ${amountToRelease} tokens to ${vestingSchedule.beneficiary.toString()}`);

  // Update vesting schedule
  vestingSchedule.amountClaimed += amountToRelease;

  // Schedule next release if tokens remain
  if (vestingSchedule.amountClaimed < vestingSchedule.totalAmount) {
    vestingSchedule.releaseSchedule[0] = Context.currentPeriod() + vestingSchedule.releaseInterval;

    // Register new deferred call
    const releaseArgs = new Args().add(beneficiary).serialize();
    const newCallSlot = findCheapestSlot(
      vestingSchedule.releaseSchedule[0],
      vestingSchedule.releaseSchedule[0] + 10,
      100000,
      releaseArgs.length
    );
    const newCallId = deferredCallRegister(
      Context.callee().toString(),
      'releaseVestedTokens',
      newCallSlot,
      100000,
      releaseArgs,
      0
    );

    generateEvent(`New release scheduled at period ${vestingSchedule.releaseSchedule[0]}, Call ID: ${newCallId}`);

    // Store new call ID
    vestingSchedule.releaseSchedule[2] = u64(parseInt(newCallId));

  } else {
    // Cancel old call
    generateEvent('Vesting completed, canceling scheduled release');
    deferredCallCancel(vestingSchedule.releaseSchedule[2].toString());
  }

  // Save updated vesting schedule
  Storage.set(VESTING_INFO_KEY, vestingSchedule.serialize());
}




export function getNextCallId(_: StaticArray<u8>): StaticArray<u8> {
  assert(Storage.has(NEXT_CALL_ID_KEY), 'No deferred call planned');
  return stringToBytes(Storage.get(NEXT_CALL_ID_KEY));
}

export function stop(_: StaticArray<u8>): void {
  assert(Storage.has(NEXT_CALL_ID_KEY), 'No deferred call to stop');
  cancelCall(Storage.get(NEXT_CALL_ID_KEY));
}

export function getVestingSchedule(_: StaticArray<u8>): StaticArray<u8> {
  const data = Storage.get(VESTING_INFO_KEY);
  assert(data.length > 0, 'No vesting schedule found');

  return data;
}

export function getTotalVested(_: StaticArray<u8>): u64 {
  const data = Storage.get(VESTING_INFO_KEY);
  assert(data.length > 0, 'No vesting schedule found');

  const vestingSchedule = new VestingSchedule();
  vestingSchedule.deserialize(data);

  return vestingSchedule.amountClaimed;
}

export function getLockedAmount(_: StaticArray<u8>): StaticArray<u8> {
  const data = Storage.get(VESTING_INFO_KEY);
  assert(data.length > 0, 'No vesting schedule found');

  const vestingSchedule = new VestingSchedule();
  vestingSchedule.deserialize(data);

  return u64ToBytes(
    vestingSchedule.totalAmount - vestingSchedule.amountClaimed,
  );
}

export function getReleaseSchedule(_: StaticArray<u8>): StaticArray<u64> {
  const data = Storage.get(VESTING_INFO_KEY);
  assert(data.length > 0, 'No vesting schedule found');

  const vestingSchedule = new VestingSchedule();
  vestingSchedule.deserialize(data);

  return StaticArray.fromArray(vestingSchedule.releaseSchedule);
}