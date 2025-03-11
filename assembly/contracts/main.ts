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
  assert(Context.isDeployingContract());

  const args = new Args(binArgs);
  const period = args.nextU64().expect('Unable to decode period');

  Storage.set(TASK_COUNT_KEY, u64ToBytes(0));
  registerCall(period);
}

export function createVestingSchedule(binArgs: StaticArray<u8>): void {
  const args = new Args(binArgs);
  const beneficiary = new Address(args.nextString().expect('Missing beneficiary address'));
  const token = new Address(args.nextString().expect('Missing token address'));
  const totalAmount = args.nextU64().expect('Missing total amount');
  const lockPeriod = args.nextU64().expect('Missing lock period');
  const releaseInterval = args.nextU64().expect('Missing release interval');
  const releasePercentage = args.nextU64().expect('Missing release percentage');

  const startPeriod = Context.currentPeriod() + lockPeriod;
  const vestingSchedule = new VestingSchedule(
    beneficiary,
     token, 
     totalAmount, 
     0, 
     lockPeriod, 
     releaseInterval, 
     releasePercentage, 
     startPeriod
    );
  
  const tokenContract = new MRC20Wrapper(token);
  const callerAddress = Context.caller();
  const calleeAddress = Context.callee();

  const allowance = tokenContract.allowance(callerAddress, calleeAddress);
  assert(allowance.toU64() >= totalAmount, 'Insufficient allowance');
  tokenContract.transferFrom(callerAddress, calleeAddress, u256.fromU64(totalAmount));
  generateEvent(`Locking ${totalAmount} tokens for vesting`);

  const releaseArgs = new Args().add(beneficiary).serialize();
  const releaseSlot = findCheapestSlot(startPeriod, startPeriod + 10, 150000, releaseArgs.length);

  const callId = deferredCallRegister(
    Context.callee().toString(),
    'releaseVestedTokens',
    releaseSlot,
    2200000,
    releaseArgs,
    2_000_000_000 
  );
  generateEvent(`Deferred call registered with ID: ${callId}`);

  vestingSchedule.nextReleasePeriod = releaseSlot.period;
  Storage.set(VESTING_INFO_KEY, vestingSchedule.serialize());
}

export function releaseVestedTokens(binArgs: StaticArray<u8>): void {
  generateEvent('releaseVestedTokens function called');
  
  const args = new Args(binArgs);
  const providedBeneficiary = new Address(args.nextString().expect('Missing beneficiary address'));

  let storedData = Storage.get(VESTING_INFO_KEY);
  if (storedData.length == 0) {
    generateEvent('No vesting schedule found');
    return;
  }
  let vestingSchedule = new VestingSchedule();
  vestingSchedule.deserialize(storedData);

  if (!providedBeneficiary.equals(vestingSchedule.beneficiary)) {
    generateEvent('Beneficiary mismatch');
    return;
  }
  
  if (Context.currentPeriod() < vestingSchedule.nextReleasePeriod) {
    generateEvent('Not yet time for release');
    return;
  }

  let amountToRelease = (vestingSchedule.totalAmount * vestingSchedule.releasePercentage) / 100;
  let remainingAmount = vestingSchedule.totalAmount - vestingSchedule.amountClaimed;
  if (amountToRelease > remainingAmount) { amountToRelease = remainingAmount; }

  
  const tokenContract = new MRC20Wrapper(vestingSchedule.token);
  tokenContract.transfer(vestingSchedule.beneficiary, u256.fromU64(amountToRelease));
  const contractBalanceAfter = tokenContract.balanceOf(Context.callee());
  const beneficiaryBalance = tokenContract.balanceOf(vestingSchedule.beneficiary);
  generateEvent(`Contract balance after: ${contractBalanceAfter.toU64()}`);
  generateEvent(`Beneficiary balance after: ${beneficiaryBalance.toU64()}`);

  vestingSchedule.amountClaimed += amountToRelease;
  generateEvent(`Releasing ${amountToRelease} tokens to ${vestingSchedule.beneficiary.toString()}`);

  if (vestingSchedule.amountClaimed < vestingSchedule.totalAmount) {
    vestingSchedule.nextReleasePeriod = Context.currentPeriod() + vestingSchedule.releaseInterval;
    const releaseArgs = new Args().add(providedBeneficiary).serialize();
    const newReleaseSlot = findCheapestSlot(
      vestingSchedule.nextReleasePeriod,
      vestingSchedule.nextReleasePeriod + 10,
      2200000,
      releaseArgs.length
    );
    const newCallId = deferredCallRegister(
      Context.callee().toString(),
      'releaseVestedTokens',
      newReleaseSlot,
      2200000,
      releaseArgs,
      2_000_000_000 
    );
    vestingSchedule.nextReleasePeriod = newReleaseSlot.period;
  }
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

/*export function getReleaseSchedule(_: StaticArray<u8>): StaticArray<u64> {
  const data = Storage.get(VESTING_INFO_KEY);
  assert(data.length > 0, 'No vesting schedule found');

  const vestingSchedule = new VestingSchedule();
  vestingSchedule.deserialize(data);

  return StaticArray.fromArray(vestingSchedule.releaseSchedule);
}*/