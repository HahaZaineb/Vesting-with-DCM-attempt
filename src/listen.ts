import {
  Account,
  EventPoller,
 
  Web3Provider,
} from '@massalabs/massa-web3';
import { SCOutputEvent } from '@massalabs/massa-web3/dist/esm/generated/client-types';

import { scheduler } from 'timers/promises';
import { CONTRACT_ADDR } from './utils';

const account = await Account.fromEnv();
const rpcUrl = 'https://labnet.massa.net/api/v2:33035';
const provider = Web3Provider.buildnet(account);

let stop = false;

const onData = async (events: SCOutputEvent[]) => {
  for (const event of events) {
    console.log(
      `Event period: ${event.context.slot.period} thread: ${event.context.slot.thread} -`,
      event.data,
    );
  }
};

const onError = (error: Error) => {
  console.error('Error:', error);
  stop = true;
};
const { stopPolling } = EventPoller.start(
  provider,
  {
    smartContractAddress: CONTRACT_ADDR,
  },
  onData,
  onError,
  5000,
);

while (!stop) {
  await scheduler.wait(5000);
}
stopPolling();
