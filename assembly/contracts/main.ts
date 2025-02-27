import { Context, Storage, Address } from '@massalabs/massa-as-sdk';
import { Args, stringToBytes, u64ToBytes, Serializable, Result } from '@massalabs/as-types';
import {
  cancelCall,
  NEXT_CALL_ID_KEY,
  registerCall,
  TASK_COUNT_KEY,
} from '../internals';

const VESTING_INFO_KEY = 'vestingInfo';

// Export task function
export { processTask } from '../internals';

class VestingSchedule implements Serializable {
  constructor(
    public beneficiary: Address = new Address(""),
    public token: Address = new Address(""),
    public totalAmount: u64 = 0,
    public amountClaimed: u64 = 0,
    public lockPeriod: u64 = 0,
    public releaseSchedule: Array<u64> = []
  ) {}

  serialize(): StaticArray<u8> {
    return new Args()
      .add(this.beneficiary)
      .add(this.token)
      .add(this.totalAmount)
      .add(this.amountClaimed)
      .add(this.lockPeriod)
      .add(this.releaseSchedule)

      .serialize();
  }

  deserialize(data: StaticArray<u8>, offset: u64 = 0): Result<i32> {
    const args = new Args(data, i32(offset));

    this.beneficiary = args.nextSerializable<Address>().expect("Failed to deserialize beneficiary.");
    this.token = args.nextSerializable<Address>().expect("Failed to deserialize token.");
    this.totalAmount = args.nextU64().expect("Failed to deserialize totalAmount.");
    this.amountClaimed = args.nextU64().expect("Failed to deserialize amountClaimed.");
    this.lockPeriod = args.nextU64().expect("Failed to deserialize lockPeriod.");
    const releaseScheduleStrings = args.nextStringArray().expect("Failed to deserialize releaseSchedule.");
    const releaseScheduleLength = args.nextU32().expect("Failed to deserialize releaseSchedule length.");
    this.releaseSchedule = new Array<u64>(releaseScheduleLength);
    for (let i = 0; i < i32(releaseScheduleLength); i++) {
      this.releaseSchedule[i] = args.nextU64().expect(`Failed to deserialize releaseSchedule at index ${i}.`);
    }

  
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
  const releaseInterval = args.nextU64().expect('Missing release interval');
  const releasePercentage = args.nextU64().expect('Missing release percentage');
  const startPeriod = Context.currentPeriod() + args.nextU64().expect('Missing lock period');

  const callId = registerCall(releaseInterval); 
  const releaseSchedule = [releasePercentage, startPeriod, u64(parseInt(callId))];
  

  const vestingSchedule = new VestingSchedule(
    beneficiary,
    token,
    totalAmount,
    0,
    startPeriod,
    releaseSchedule
  );

  Storage.set(VESTING_INFO_KEY, vestingSchedule.serialize().toString());
}


export function releaseVestedTokens(_: StaticArray<u8>): void {
  const data = Storage.get(VESTING_INFO_KEY);
  assert(data.length > 0, 'No vesting schedule found');

  const storedData = Storage.get<StaticArray<u8>>(stringToBytes(VESTING_INFO_KEY));
  const vestingSchedule = new VestingSchedule();
  vestingSchedule.deserialize(storedData);

  assert(Context.currentPeriod() >= vestingSchedule.lockPeriod, 'Vesting period has not started');
  assert(vestingSchedule.amountClaimed < vestingSchedule.totalAmount, 'All tokens released');

  const amountToRelease = (vestingSchedule.totalAmount * vestingSchedule.releaseSchedule[0]) / 100;
  const newReleasedAmount = vestingSchedule.amountClaimed + amountToRelease;

  if (newReleasedAmount >= vestingSchedule.totalAmount) {
    vestingSchedule.amountClaimed = vestingSchedule.totalAmount;
    cancelCall(vestingSchedule.releaseSchedule[2].toString());
  } else {
    vestingSchedule.amountClaimed = newReleasedAmount;
    vestingSchedule.releaseSchedule[2] = u64(parseInt(registerCall(vestingSchedule.releaseSchedule[1])));
  }

  Storage.set(VESTING_INFO_KEY, vestingSchedule.serialize().toString());
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

  return stringToBytes(data);  
}

export function getTotalVested(_: StaticArray<u8>): u64 {
  const data = Storage.get(VESTING_INFO_KEY);
  assert(data.length > 0, 'No vesting schedule found');
  
  const vestingSchedule = new VestingSchedule();
  vestingSchedule.deserialize(stringToBytes(data));

  return vestingSchedule.amountClaimed;  
}

export function getLockedAmount(_: StaticArray<u8>): u64 {
  const data = Storage.get(VESTING_INFO_KEY);
  assert(data.length > 0, 'No vesting schedule found');

  const vestingSchedule = new VestingSchedule();
  vestingSchedule.deserialize(stringToBytes(data));

  return vestingSchedule.totalAmount - vestingSchedule.amountClaimed;  
}


export function getReleaseSchedule(_: StaticArray<u8>): StaticArray<u64> {
  const data = Storage.get(VESTING_INFO_KEY);
  assert(data.length > 0, 'No vesting schedule found');

  const vestingSchedule = new VestingSchedule();
  vestingSchedule.deserialize(stringToBytes(data));

  // Convert Array<u64> to StaticArray<u64>
  return StaticArray.fromArray(vestingSchedule.releaseSchedule);
}
