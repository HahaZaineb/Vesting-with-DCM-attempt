import {
  Context,
  Storage,
  Address,
  generateEvent,
  deferredCallRegister,
  findCheapestSlot,
  deferredCallCancel,
  deferredCallExists,
  deferredCallQuote  
} from '@massalabs/massa-as-sdk';
import {
  Args,
  Serializable,
  Result,
  stringToBytes,
  bytesToString
} from '@massalabs/as-types';
import {
  cancelCall,
  NEXT_CALL_ID_KEY,
  registerCall,
  TASK_COUNT_KEY,
} from '../internals';
import { MRC20Wrapper } from '@massalabs/sc-standards/assembly/contracts/MRC20/wrapper';
import { u256 } from 'as-bignum/assembly';

const VESTING_INFO_KEY = stringToBytes('vestingInfo');
const RELEASE_LOCK_KEY = stringToBytes('releaseLock');
const PAUSED_KEY = stringToBytes('paused');
const OWNER_KEY = stringToBytes('owner');
const LAST_EXECUTION_STATUS_KEY = stringToBytes('lastExecutionStatus');
const LAST_FAILED_PERIOD_KEY = stringToBytes('lastFailedPeriod');

export { processTask } from '../internals';

class vestingSchedule implements Serializable {
  constructor(
    public beneficiary: Address = new Address(''),
    public token: Address = new Address(''),
    public totalAmount: u64 = 0,
    public amountClaimed: u64 = 0,
    public lockPeriod: u64 = 0,
    public releaseInterval: u64 = 0,
    public releasePercentage: u64 = 0,
    public nextReleasePeriod: u64 = 0
  ) {}

  serialize(): StaticArray<u8> {
    return new Args()
      .add(this.beneficiary)
      .add(this.token)
      .add(this.totalAmount)
      .add(this.amountClaimed)
      .add(this.lockPeriod)
      .add(this.releaseInterval)
      .add(this.releasePercentage)
      .add(this.nextReleasePeriod)
      .serialize();
  }

  deserialize(data: StaticArray<u8>, offset: u64 = 0): Result<i32> {
    const args = new Args(data, i32(offset));

    this.beneficiary = args.nextSerializable<Address>().expect('Failed to deserialize beneficiary.');
    this.token = args.nextSerializable<Address>().expect('Failed to deserialize token.');
    this.totalAmount = args.nextU64().expect('Failed to deserialize totalAmount.');
    this.amountClaimed = args.nextU64().expect('Failed to deserialize amountClaimed.');
    this.lockPeriod = args.nextU64().expect('Failed to deserialize lockPeriod.');
    this.releaseInterval = args.nextU64().expect('Failed to deserialize releaseInterval.');
    this.releasePercentage = args.nextU64().expect('Failed to deserialize releasePercentage.');
    this.nextReleasePeriod = args.nextU64().expect('Failed to deserialize nextReleasePeriod.');

    return new Result(args.offset);
  }
}

export function constructor(binArgs: StaticArray<u8>): void {
  assert(Context.isDeployingContract(), "Not in deployment context");

  const args = new Args(binArgs);
  const period = args.nextU64().expect('Unable to decode period');
  
  // Store the contract owner (deployer)
  Storage.set(OWNER_KEY, stringToBytes(Context.caller().toString()));
  
  Storage.set(TASK_COUNT_KEY, new Args().add(0 as u64).serialize());
  registerCall(period);
  
  generateEvent("Contract initialized successfully");
}

export function createVestingSchedule(binArgs: StaticArray<u8>): void {
  const args = new Args(binArgs);
  const beneficiary = args.nextString().expect('Missing beneficiary address');
  const token = args.nextString().expect('Missing token address');
  const totalAmount = args.nextU64().expect('Missing total amount');
  const lockPeriod = args.nextU64().expect('Missing lock period');
  const releaseInterval = args.nextU64().expect('Missing release interval');
  const releasePercentage = args.nextU64().expect('Missing release percentage');

  // Check if contract is paused
  if (Storage.has(PAUSED_KEY)) {
    generateEvent("Contract is paused");
    return;
  }

  // Validate inputs
  assert(totalAmount > 0, "Total amount must be greater than 0");
  assert(releasePercentage > 0 && releasePercentage <= 100, "Release percentage must be between 1 and 100");
  assert(releaseInterval > 0, "Release interval must be greater than 0");
  
  const startPeriod = Context.currentPeriod() + lockPeriod;
  const schedule = new vestingSchedule(
    new Address(beneficiary),
    new Address(token), 
    totalAmount, 
    0, 
    lockPeriod, 
    releaseInterval, 
    releasePercentage, 
    startPeriod
  );
  
  const tokenContract = new MRC20Wrapper(schedule.token);
  const callerAddress = Context.caller();
  const calleeAddress = Context.callee();

  // Check token allowance and transfer tokens to contract
  const allowance = tokenContract.allowance(callerAddress, calleeAddress);
  assert(allowance.toU64() >= totalAmount, 'Insufficient allowance');
  
  // Get balance before transfer
  const contractBalanceBefore = tokenContract.balanceOf(calleeAddress);
  generateEvent(`Contract token balance before: ${contractBalanceBefore.toU64()}`);
  
  // Transfer tokens from caller to contract
  tokenContract.transferFrom(callerAddress, calleeAddress, u256.fromU64(totalAmount));
  
  // Verify transfer was successful
  const contractBalanceAfter = tokenContract.balanceOf(calleeAddress);
  generateEvent(`Contract token balance after: ${contractBalanceAfter.toU64()}`);
  assert(
    contractBalanceAfter.toU64() >= contractBalanceBefore.toU64() + totalAmount,
    "Token transfer failed"
  );
  
  generateEvent(`Locking ${totalAmount} tokens for vesting`);

  // Register first errdefed call - DIRECTLY to releaseVestedTokens
  const releaseArgs = new Args().add(beneficiary).serialize();
  const releaseSlot = findCheapestSlot(startPeriod, startPeriod + 10, 150000, releaseArgs.length);

  const quote = deferredCallQuote(
    releaseSlot,
    2200000,
    releaseArgs.length,
  );
  generateEvent(`Estimated booking fee: ${quote} nanoMAS`);

  const callId = deferredCallRegister(
    Context.callee().toString(),
    'releaseVestedTokens', 
    releaseSlot,
    2200000,
    releaseArgs,
    0
  );
  const test = deferredCallExists(callId);
  generateEvent(`Call exists: ${test}`);
  generateEvent(`Deferred call registered with ID: ${callId}`);

  schedule.nextReleasePeriod = releaseSlot.period;
  Storage.set(VESTING_INFO_KEY, schedule.serialize());
  
  generateEvent(`Vesting schedule created for ${beneficiary}`);
  generateEvent(`First release scheduled for period ${releaseSlot.period}`);
}

export function releaseVestedTokens(binArgs: StaticArray<u8>): void {
  generateEvent('releaseVestedTokens function called');
     
  const args = new Args(binArgs);

  const providedBeneficiary = args.nextString().expect('Missing beneficiary address');

  // Get vesting schedule
  let storedData = Storage.get(VESTING_INFO_KEY);
  if (storedData.length == 0) {
    generateEvent('No vesting schedule found');
    return;
  }
  
  let schedule = new vestingSchedule();
  schedule.deserialize(storedData);

  // Validate beneficiary
  if (!new Address(providedBeneficiary).equals(schedule.beneficiary)) {
    generateEvent('Beneficiary mismatch');
    return;
  }
  
  
  const currentPeriod = Context.currentPeriod();
  generateEvent(`Current period: ${currentPeriod}, Next release period: ${schedule.nextReleasePeriod}`);

  if (currentPeriod < schedule.nextReleasePeriod) {
    generateEvent('Not yet time for release');
    return;
  }

   
  // Calculate release amount
  generateEvent(`Total amount: ${schedule.totalAmount}, Already claimed: ${schedule.amountClaimed}`);
  let amountToRelease = (schedule.totalAmount * schedule.releasePercentage) / 100;
  let remainingAmount = schedule.totalAmount - schedule.amountClaimed;
  
  if (amountToRelease > remainingAmount) { 
    amountToRelease = remainingAmount; 
    generateEvent(`Adjusted release amount to remaining: ${amountToRelease}`);
  }
  
  const tokenContract = new MRC20Wrapper(schedule.token);
  
  // Get balances before transfer
  const contractBalanceBefore = tokenContract.balanceOf(Context.callee());
  const beneficiaryBalanceBefore = tokenContract.balanceOf(schedule.beneficiary);
  generateEvent(`Contract balance before: ${contractBalanceBefore.toU64()}`);
  generateEvent(`Beneficiary balance before: ${beneficiaryBalanceBefore.toU64()}`);
  
  const address= new Address("AU1264Bah4q6pYLrGBh27V1b9VXL2XmnQCwMhY74HW4dxahpqxkrN")
  // Transfer tokens
  tokenContract.transfer(address , u256.fromU64(amountToRelease), 0);
  
  // Verify transfer was successful
  const contractBalanceAfter = tokenContract.balanceOf(Context.callee());
  const beneficiaryBalanceAfter = tokenContract.balanceOf(schedule.beneficiary);
  generateEvent(`Contract balance after: ${contractBalanceAfter.toU64()}`);
  generateEvent(`Beneficiary balance after: ${beneficiaryBalanceAfter.toU64()}`);
  
  // Verify transfer success
  assert(
    beneficiaryBalanceAfter.toU64() > beneficiaryBalanceBefore.toU64(),
    "Token transfer failed"
  );

  // Update vesting schedule
  schedule.amountClaimed += amountToRelease;
  generateEvent(`Released ${amountToRelease} tokens to ${schedule.beneficiary.toString()}`);

  // Schedule next release only if not complete
  if (schedule.amountClaimed < schedule.totalAmount) {
    schedule.nextReleasePeriod = currentPeriod + schedule.releaseInterval;
    const releaseArgs = new Args().add(providedBeneficiary).serialize();
    const newReleaseSlot = findCheapestSlot(
      schedule.nextReleasePeriod,
      schedule.nextReleasePeriod + 10,
      2200000,
      releaseArgs.length
    );
    
    // Store current state before registering next call
    Storage.set(VESTING_INFO_KEY, schedule.serialize()); 

    const quote = deferredCallQuote(
      newReleaseSlot,
      2200000,
      releaseArgs.length,
    );

    generateEvent(`Estimated booking fee: ${quote} nanoMAS`);
    const newCallId = deferredCallRegister(
      Context.callee().toString(),
      'releaseVestedTokens', 
      newReleaseSlot,
      2200000,
      releaseArgs,
      0
    );

    generateEvent(`Next release scheduled for period ${newReleaseSlot.period} with ID: ${newCallId}`);
    schedule.nextReleasePeriod = newReleaseSlot.period;

  } else {
    generateEvent("Vesting schedule completed");
  }
  
  // Update final state
  Storage.set(VESTING_INFO_KEY, schedule.serialize());
  

}

export function getExecutionStatus(_: StaticArray<u8>): StaticArray<u8> {
  if (!Storage.has(LAST_EXECUTION_STATUS_KEY)) {
    return stringToBytes('success');
  }
  return Storage.get(LAST_EXECUTION_STATUS_KEY);
}

export function recoverFailedRelease(binArgs: StaticArray<u8>): void {
  assert(Storage.has(LAST_EXECUTION_STATUS_KEY), "No failed execution to recover");
  const lastStatus = Storage.get(LAST_EXECUTION_STATUS_KEY);
  assert(bytesToString(lastStatus) === 'failed', "Last execution was successful");
  const args = new Args(binArgs);
  const caller = Context.caller();
  
  // Check if owner
  const ownerStr = Storage.get(OWNER_KEY);
  const owner = new Address(bytesToString(ownerStr));
  const isOwner = caller.equals(owner);
  
  // Get vesting schedule
  let storedData = Storage.get(VESTING_INFO_KEY);
  if (storedData.length == 0) {
    generateEvent('No vesting schedule found');
    return;
  }
  
  let schedule = new vestingSchedule();
  schedule.deserialize(storedData);
  
  // Check if caller is authorized
  const isBeneficiary = caller.equals(schedule.beneficiary);
  assert(isOwner || isBeneficiary, "Unauthorized");
  
  // Check if a release is due
  assert(
    Context.currentPeriod() >= schedule.nextReleasePeriod,
    "No release due yet"
  );
  
  // Prevent concurrent releases
  if (Storage.has(RELEASE_LOCK_KEY)) {
    generateEvent('Release already in progress');
    return;
  }
  Storage.set(RELEASE_LOCK_KEY, stringToBytes('locked'));
  
  generateEvent("Recovering failed release");
  
  // Calculate amount to release
  let amountToRelease = (schedule.totalAmount * schedule.releasePercentage) / 100;
  let remainingAmount = schedule.totalAmount - schedule.amountClaimed;
  
  if (amountToRelease > remainingAmount) { 
    amountToRelease = remainingAmount; 
  }
  
  // Perform token transfer
  const tokenContract = new MRC20Wrapper(schedule.token);
  
  // Get balances before transfer
  const contractBalanceBefore = tokenContract.balanceOf(Context.callee());
  const beneficiaryBalanceBefore = tokenContract.balanceOf(schedule.beneficiary);
  
  // Transfer tokens
  tokenContract.transfer(schedule.beneficiary, u256.fromU64(amountToRelease));
  
  // Verify transfer was successful
  const contractBalanceAfter = tokenContract.balanceOf(Context.callee());
  const beneficiaryBalanceAfter = tokenContract.balanceOf(schedule.beneficiary);
  
  // Update vesting schedule
  schedule.amountClaimed += amountToRelease;
  generateEvent(`Recovered release of ${amountToRelease} tokens to ${schedule.beneficiary.toString()}`);
  
  // Schedule next release if needed
  if (schedule.amountClaimed < schedule.totalAmount) {
    schedule.nextReleasePeriod = Context.currentPeriod() + schedule.releaseInterval;
    const releaseArgs = new Args().add(schedule.beneficiary.toString()).serialize();
    const newReleaseSlot = findCheapestSlot(
      schedule.nextReleasePeriod,
      schedule.nextReleasePeriod + 10,
      2200000,
      releaseArgs.length
    );
    
    const newCallId = deferredCallRegister(
      Context.callee().toString(),
      'releaseVestedTokens',
      newReleaseSlot,
      2200000,
      releaseArgs,
      0
    );
    schedule.nextReleasePeriod = newReleaseSlot.period;
  }
  
  // Update storage
  Storage.set(VESTING_INFO_KEY, schedule.serialize());
  
  // Release lock
  Storage.del(RELEASE_LOCK_KEY);
  Storage.del(LAST_EXECUTION_STATUS_KEY);
  Storage.del(LAST_FAILED_PERIOD_KEY);
}

export function pauseVesting(_: StaticArray<u8>): void {
  // Only owner can pause
  const ownerStr = Storage.get(OWNER_KEY);
  const owner = new Address(bytesToString(ownerStr));
  assert(Context.caller().equals(owner), "Unauthorized");
  
  // Check if already paused
  if (Storage.has(PAUSED_KEY)) {
    generateEvent("Already paused");
    return;
  }
  
  // Check if there's an active deferred call
  if (Storage.has(NEXT_CALL_ID_KEY)) {
    // Cancel the next scheduled release
    cancelCall(Storage.get(NEXT_CALL_ID_KEY));
    generateEvent("Cancelled scheduled release");
  }
  
  Storage.set(PAUSED_KEY, stringToBytes('true'));
  generateEvent("Vesting schedule paused");
}

export function resumeVesting(_: StaticArray<u8>): void {
  // Only owner can resume
  const ownerStr = Storage.get(OWNER_KEY);
  const owner = new Address(bytesToString(ownerStr));
  assert(Context.caller().equals(owner), "Unauthorized");
  
  // Check if paused
  assert(Storage.has(PAUSED_KEY), "Not paused");
  
  // Re-schedule the next release
  let schedule = new vestingSchedule();
  schedule.deserialize(Storage.get(VESTING_INFO_KEY));
  
  // Schedule the next release
  const releaseArgs = new Args().add(schedule.beneficiary.toString()).serialize();
  const releaseSlot = findCheapestSlot(
    Context.currentPeriod(),
    Context.currentPeriod() + 10,
    2200000,
    releaseArgs.length
  );
  
  const callId = deferredCallRegister(
    Context.callee().toString(),
    'releaseVestedTokens',
    releaseSlot,
    2200000,
    releaseArgs,
    0
  );
  
  schedule.nextReleasePeriod = releaseSlot.period;
  Storage.set(VESTING_INFO_KEY, schedule.serialize());
  Storage.del(PAUSED_KEY);
  generateEvent(`Vesting schedule resumed. Next release at period ${releaseSlot.period}`);
}

export function getNextCallId(_: StaticArray<u8>): StaticArray<u8> {
  assert(Storage.has(NEXT_CALL_ID_KEY), 'No deferred call planned');
  return stringToBytes(Storage.get(NEXT_CALL_ID_KEY));
}

export function stop(_: StaticArray<u8>): void {
  
  const ownerStr = Storage.get(OWNER_KEY);
  const owner = new Address(bytesToString(ownerStr));
  assert(Context.caller().equals(owner), "Unauthorized");
  
  assert(Storage.has(NEXT_CALL_ID_KEY), 'No deferred call to stop');
  cancelCall(Storage.get(NEXT_CALL_ID_KEY));
  generateEvent("Stopped scheduled releases");
}

export function getVestingSchedule(_: StaticArray<u8>): StaticArray<u8> {
  const data = Storage.get(VESTING_INFO_KEY);
  assert(data.length > 0, 'No vesting schedule found');

  return data;
}

export function getTotalVested(_: StaticArray<u8>): u64 {
  const data = Storage.get(VESTING_INFO_KEY);
  assert(data.length > 0, 'No vesting schedule found');

  const schedule = new vestingSchedule();
  schedule.deserialize(data);

  return schedule.amountClaimed;
}

export function getLockedAmount(_: StaticArray<u8>): StaticArray<u8> {
  const data = Storage.get(VESTING_INFO_KEY);
  assert(data.length > 0, 'No vesting schedule found');

  const schedule = new vestingSchedule();
  schedule.deserialize(data);

  return new Args().add(schedule.totalAmount - schedule.amountClaimed).serialize();
}

export function getContractInfo(_: StaticArray<u8>): StaticArray<u8> {
  const isPaused = Storage.has(PAUSED_KEY);
  const owner = Storage.get(OWNER_KEY);
  
  return new Args()
    .add(isPaused)
    .add(bytesToString(owner))
    .serialize();
}

export function transferOwnership(binArgs: StaticArray<u8>): void {
  // Only owner can transfer ownership
  const ownerStr = Storage.get(OWNER_KEY);
  const owner = new Address(bytesToString(ownerStr));
  assert(Context.caller().equals(owner), "Unauthorized");
  
  const args = new Args(binArgs);
  const newOwner = args.nextString().expect('Missing new owner address');
  
  Storage.set(OWNER_KEY, stringToBytes(newOwner));
  generateEvent(`Ownership transferred to ${newOwner}`);
  
}