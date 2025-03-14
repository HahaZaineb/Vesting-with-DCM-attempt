import {
  Args,
  bytesToU64,
  stringToBytes,
  u64ToBytes,
} from '@massalabs/as-types';
import {
  Address,
  balance,
  Context,
  deferredCallCancel,
  deferredCallExists,
  deferredCallQuote,
  deferredCallRegister,
  findCheapestSlot,
  generateEvent,
  Slot,
  Storage,
} from '@massalabs/massa-as-sdk';
import { releaseVestedTokens } from './contracts/main';
import { History } from './serializable/history';

export const NEXT_CALL_ID_KEY = 'callId';
export const HISTORY_KEY = stringToBytes('hist');
export const TASK_COUNT_KEY = stringToBytes('idx');

export function registerCall(period: u64): void {
  const maxGas = 22_000_000;
  const params_size = 0;
  const bookingPeriod = Context.currentPeriod() + period;
  const slot = findCheapestSlot(bookingPeriod, bookingPeriod, maxGas, params_size);

  const callId = deferredCallRegister(
    Context.callee().toString(),
    'processTask',
    slot,
    2200000,
    new Args().add(0 as u64).add("").serialize(),
    0
  );
  
  Storage.set(NEXT_CALL_ID_KEY, callId);
  generateEvent(`Registered call with ID: ${callId}`);
}

function getTaskIndex(): u64 {
  return bytesToU64(Storage.get(TASK_COUNT_KEY));
}

function getHistoryKey(taskIndex: u64): StaticArray<u8> {
  return HISTORY_KEY.concat(u64ToBytes(taskIndex));
}

export function processTask(binArgs: StaticArray<u8>): void {
  generateEvent("processTask called");
  const args = new Args(binArgs);
  const taskId = args.nextU64().expect('Unable to decode task id');
  generateEvent(`Processing task ${taskId}`);
  
  const beneficiary = new Address("AU1264Bah4q6pYLrGBh27V1b9VXL2XmnQCwMhY74HW4dxahpqxkrN")
  if (!beneficiary) {
    throw new Error('Beneficiary cannot be empty');
  }
  generateEvent(`Beneficiary: ${beneficiary}`);
  
  const releaseArgs = new Args().add(beneficiary).serialize();
   
  generateEvent("Forwarding to releaseVestedTokens");
  releaseVestedTokens(releaseArgs);
  
    const CURRENT_RELEASE_KEY = stringToBytes('current_release');
  //Storage.set(CURRENT_RELEASE_KEY, stringToBytes(beneficiary));
  
  generateEvent("Set current release beneficiary for processing");
}

export function cancelCall(callId: string): void {
  if (deferredCallExists(callId)) {
    deferredCallCancel(callId);
    generateEvent('Deferred call canceled. id : ' + callId);
  } else {
    generateEvent('Deferred call does not exist. id: ' + callId);
  }
}
