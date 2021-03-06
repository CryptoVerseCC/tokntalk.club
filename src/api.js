import uuidv4 from 'uuid/v4';
import partition from 'lodash/partition';
import find from 'lodash/fp/find';
import last from 'lodash/fp/last';
import { isAddress, BN } from 'web3-utils';

import { getEntityInfoForAddress, getCurrentProviderName } from './utils';
import getWeb3 from './web3';
import {
  claimContractAddressesForNetworkId,
  claimContractAbi,
  networkNameForNetworkId,
  networkExplorerForNetworkId,
  claimWithValueTransferContractAddressesForNetworkId,
  claimWithTokenValueTransferContractAddressesForNetworkId,
  claimWithConfigurableValueMultiTransferContractAddressesForNetworkId,
  claimWithConfigurableTokenValueMultiTransferContractAddressesForNetworkId,
  claimWithValueTransferContractAbi,
  claimWithTokenValueTransferContractAbi,
  erc20ContractAbi,
  erc721ContractAbi,
  mintTokensContractAbi,
  ERC20Bytecode,
} from './contract';
import { getEntityData, getEntityId, getEntityPrefix } from './entityApi';
import { findClub } from './clubs';
import { toWei } from './balance';
import ercs721 from './erc721';

const {
  REACT_APP_USERFEEDS_API_ADDRESS: USERFEEDS_API_ADDRESS,
  REACT_APP_INTERFACE_VALUE: INTERFACE_VALUE,
  REACT_APP_INTERFACE_BOOST_ADDRESS: INTERFACE_BOOST_ADDRESS,
} = process.env;

export const isValidAndSupportedErc721 = (address) => !!find({ address })(ercs721);

export const hasValidContext = ({ context }) => {
  if (!context) return true;
  const [, address] = context.split(':');
  return isValidAndSupportedErc721(address);
};

const SUPPORTED_FEED_TYPES = [
  'regular',
  'like',
  'post_to',
  'post_about',
  'post_club',
  'social',
  'post_to_simple',
  'boost',
  'response',
];
export const isValidFeedItem = (feedItem) => {
  if (!SUPPORTED_FEED_TYPES.includes(feedItem.type)) {
    return false;
  }
  if (feedItem.type === 'post_club') {
    const [network, address] = feedItem.about.split(':');
    if (['ethereum', 'kovan', 'rinkeby', 'ropsten'].indexOf(network) === -1 || !isAddress(address)) {
      return false;
    }
  }

  if (feedItem.type === 'boost' && (!feedItem.about || !feedItem.target)) {
    return false;
  }

  if (!feedItem.context) {
    return true;
  } else if (!hasValidContext(feedItem)) {
    return false;
  }

  if (typeof feedItem.target === 'object' && !hasValidContext(feedItem.target)) {
    return false;
  }

  feedItem.likes = feedItem.likes.filter(hasValidContext);
  feedItem.replies = feedItem.replies.filter(hasValidContext).map((reply) => {
    reply.likes = reply.likes.filter(hasValidContext);
    return reply;
  });

  return true;
};

const enhanceContextInfo = (context, context_info) => {
  if (!context_info.name) {
    context_info.name = `${getEntityPrefix(context)}${getEntityId(context)}`;
  }

  return context_info;
};

export const enhanceFeedItem = (feedItem) => {
  if (!!feedItem.context_info) {
    feedItem.context_info = enhanceContextInfo(feedItem.context, feedItem.context_info);
  }

  if (feedItem.type === 'post_to_simple') {
    feedItem.about_info = getEntityInfoForAddress(feedItem.about);
    feedItem.type = 'post_to';
  }

  if (feedItem.type === 'post_club') {
    const [network, address] = feedItem.about.split(':');
    const club = findClub(network, address);
    feedItem.about_info = club;
  }

  if (feedItem.type === 'response') {
    feedItem.reply_to = enhanceFeedItem(feedItem.reply_to);
  }

  if (feedItem.type === 'boost' && feedItem.about) {
    feedItem.about_info = feedItem.about_info ? feedItem.about_info : getEntityInfoForAddress(feedItem.about);
    feedItem.target_info = feedItem.target_info ? feedItem.target_info : getEntityInfoForAddress(feedItem.target);
  }

  if (feedItem.likes) {
    feedItem.likes = feedItem.likes.map(enhanceFeedItem);
  }

  if (feedItem.replies) {
    feedItem.replies = feedItem.replies.map(enhanceFeedItem).map((reply) => {
      reply.likes = reply.likes.map(enhanceFeedItem);
      return reply;
    });
  }

  if (typeof feedItem.target === 'object') {
    feedItem.target = enhanceFeedItem(feedItem.target);
  }

  if (!!feedItem.context) {
    return feedItem;
  }

  return { ...feedItem, author_info: getEntityInfoForAddress(feedItem.author), isFromAddress: true };
};

export const getFeedItem = async ({ claimId }) => {
  let { items: feedItems } = await getRanking(
    [{ algorithm: 'cryptoverse_thread_root_feed', params: { id: claimId } }],
    'api/decorate-with-opensea',
  );

  feedItems = feedItems.filter(isValidFeedItem).map(enhanceFeedItem);

  const item = feedItems[0];
  item.replies = flattenReplies(item);
  return item;
};

const flattenReplies = (item) => {
  if (item.replies) {
    return item.replies.reduce((acc, element) => acc.concat(element, ...flattenReplies(element)), []);
  } else {
    return [];
  }
};

export const getFeedItemsFromCache = (algorithm = 'cache-cryptoverse-feed') => async ({
  lastVersion,
  oldestKnown,
  size,
}) => {
  const versionParam = lastVersion ? `lastVersion=${lastVersion}` : '';
  const oldestParam = oldestKnown ? `oldestKnown=${oldestKnown}` : '';
  const sizeParam = size ? `size=${size}` : '';

  const response = await fetch(
    `${USERFEEDS_API_ADDRESS}/api/${algorithm}?${versionParam}&${oldestParam}&${sizeParam}`,
  ).then((r) => r.json());

  const { items, total, version } = response;
  const validFeedItems = items.filter(isValidFeedItem).map(enhanceFeedItem);
  const lastItem = last(items);

  return { feedItems: validFeedItems, total, version, lastItemId: lastItem ? lastItem.id : undefined };
};

export const getRanking = (flow, path = 'ranking') => {
  return fetch(`${USERFEEDS_API_ADDRESS}/${path}`, {
    method: 'POST',
    body: JSON.stringify({ flow }),
    headers: {
      'content-type': 'application/json',
    },
  }).then((res) => res.json());
};

export const getMyEntities = async () => {
  const web3 = await getWeb3();
  const [from] = await web3.eth.getAccounts();
  if (!from) return [];

  return [getEntityInfoForAddress(from), ...(await getEntities(from))];
};

export const getEntities = async (from) =>
  getRanking(
    [
      {
        algorithm: 'cryptoverse_tokens',
        params: {
          identity: from.toLowerCase(),
          asset: ercs721.map(({ address: erc721Address }) => `ethereum:${erc721Address.toLowerCase()}`),
        },
      },
    ],
    'api/decorate-with-opensea',
  ).then(({ items }) =>
    items

      .filter(({ context_info: { image_preview_url } }) => image_preview_url !== null)
      .map(({ context, context_info }) => {
        const name = context_info.name ? context_info.name : `${getEntityPrefix(context)}${getEntityId(context)}`;
        return {
          ...context_info,
          id: context,
          background_color: undefined,
          tokens: [],
          name,
        };
      }),
  );

export const getLabels = async (entityId) => {
  try {
    const res = await fetch(`${USERFEEDS_API_ADDRESS}/ranking/cryptoverse_profile;id=${entityId}`);
    const labels = await res.json();
    return labels;
  } catch (e) {
    return {};
  }
};

export const getEntityTokens = async (entityId) => {
  const entityTokens = await getRanking([
    {
      algorithm: 'cryptoverse_balances',
      params: {
        entity: entityId,
      },
    },
  ]);

  const tokens = Object.entries(entityTokens)
    .map(([token]) => token.split(':'))
    .map(([network, address]) => findClub(network, address));

  const [customTokens, supportedTokens] = partition(tokens, 'isCustom');
  const customTokensInfo = customTokens.length
    ? await getAssetsInfo(customTokens.map(({ network, address }) => `${network}:${address}`))
    : {};
  const enhancedCustomClubs = customTokens.map((token) => {
    if (!customTokensInfo[token.asset]) {
      return token;
    }
    const { name, shortName, symbol } = customTokensInfo[token.asset];
    return token.extend({ name, shortName, symbol });
  });

  return [...supportedTokens, ...enhancedCustomClubs];
};

export const getAssetsInfo = async (assets) => {
  const assetsInfo = await getRanking([
    {
      algorithm: 'cryptoverse_token_info',
      params: {
        id: assets,
      },
    },
  ]);

  Object.keys(assetsInfo).map(
    (key) =>
      (assetsInfo[key].shortName = `${assetsInfo[key].name.substr(0, 7)}...${assetsInfo[key].name.substring(
        assetsInfo[key].name.length - 5,
      )}`),
  );

  return assetsInfo;
};

export const getBoosts = async (token, asset) => {
  try {
    const res = await getRanking(
      [
        {
          algorithm: 'cryptoverse_boost',
          params: {
            asset,
            entity: token,
            fee_address: INTERFACE_BOOST_ADDRESS,
          },
        },
      ],
      'api/decorate-with-opensea',
    );

    const { items: boosts } = res;
    const boostsMap = boosts.reduce((acc, boost) => {
      if (isAddress(boost.id)) {
        return { ...acc, [boost.id]: { ...boost, context_info: getEntityInfoForAddress(boost.id) } };
      }
      const [, address] = boost.id.split(':');
      if (!find({ address })(ercs721)) {
        return acc;
      }
      return { ...acc, [boost.id]: boost };
    }, {});
    return boostsMap;
  } catch (e) {
    return {};
  }
};

export const getSupportings = async (token, asset) => {
  try {
    const res = await getRanking(
      [
        {
          algorithm: 'cryptoverse_supporting',
          params: {
            asset,
            entity: token,
            fee_address: INTERFACE_BOOST_ADDRESS,
          },
        },
      ],
      'api/decorate-with-opensea',
    );

    const { items: supporting } = res;
    const supportersMap = supporting.reduce((acc, superstinger) => {
      if (isAddress(superstinger.id)) {
        return {
          ...acc,
          [superstinger.id]: { ...superstinger, context_info: getEntityInfoForAddress(superstinger.id) },
        };
      }
      const [, address] = superstinger.id.split(':');
      if (!find({ address })(ercs721)) {
        return acc;
      }
      return { ...acc, [superstinger.id]: superstinger };
    }, {});
    return supportersMap;
  } catch (e) {
    return {};
  }
};

export const getWeb3State = async (storage) => {
  try {
    const web3 = await getWeb3(storage);
    const [[from], isListening, networkId, blockNumber] = await Promise.all([
      web3.eth.getAccounts(),
      web3.eth.net.isListening(),
      web3.eth.net.getId(),
      web3.eth.getBlockNumber(),
    ]);
    const networkName = networkNameForNetworkId[networkId];
    const explorerDomain = networkExplorerForNetworkId[networkId];
    const provider = getCurrentProviderName();
    return {
      from,
      isListening,
      networkId,
      blockNumber,
      web3,
      networkName,
      explorerDomain,
      provider,
    };
  } catch (e) {
    return {
      from: undefined,
      isListening: false,
      networkId: undefined,
      blockNumber: undefined,
      web3: undefined,
      networkName: undefined,
      explorerDomain: undefined,
      provider: false,
    };
  }
};

const getCreditsData = () => [{ type: 'interface', value: INTERFACE_VALUE }];

const getClaimContract = async () => {
  const web3 = await getWeb3();
  const { networkId } = await getWeb3State();
  const contractAddress = claimContractAddressesForNetworkId[networkId];
  const contract = new web3.eth.Contract(claimContractAbi, contractAddress);
  contract.setProvider(web3.currentProvider);
  return contract;
};

const getClaimWithValueTransferContract = async () => {
  const web3 = await getWeb3();
  const { networkId } = await getWeb3State();
  const contractAddress = claimWithValueTransferContractAddressesForNetworkId[networkId];
  const contract = new web3.eth.Contract(claimWithValueTransferContractAbi, contractAddress);
  contract.setProvider(web3.currentProvider);
  return contract;
};

const getClaimWithTokenValueTransferContract = async () => {
  const web3 = await getWeb3();
  const { networkId } = await getWeb3State();
  const contractAddress = claimWithTokenValueTransferContractAddressesForNetworkId[networkId];
  const contract = new web3.eth.Contract(claimWithTokenValueTransferContractAbi, contractAddress);
  contract.setProvider(web3.currentProvider);
  return contract;
};

const getClaimWithConfigurableValueMultiTransferContract = async () => {
  const web3 = await getWeb3();
  const { networkId } = await getWeb3State();
  const contractAddress = claimWithConfigurableValueMultiTransferContractAddressesForNetworkId[networkId];
  const contract = new web3.eth.Contract(claimWithValueTransferContractAbi, contractAddress);
  contract.setProvider(web3.currentProvider);
  return contract;
};

export const getClaimWithConfigurableTokenValueMultiTransferContract = async () => {
  const web3 = await getWeb3();
  const { networkId } = await getWeb3State();
  const contractAddress = claimWithConfigurableTokenValueMultiTransferContractAddressesForNetworkId[networkId];
  const contract = new web3.eth.Contract(claimWithTokenValueTransferContractAbi, contractAddress);
  contract.setProvider(web3.currentProvider);
  return contract;
};

const getErc20Contract = async (contractAddress) => {
  const web3 = await getWeb3();
  const contract = new web3.eth.Contract(erc20ContractAbi, contractAddress);
  contract.setProvider(web3.currentProvider);
  return contract;
};

const getErc721Contract = async (contractAddress) => {
  const web3 = await getWeb3();
  const contract = new web3.eth.Contract(erc721ContractAbi, contractAddress);
  contract.setProvider(web3.currentProvider);
  return contract;
};

const createFeedItemBase = async (id, entity, http) => {
  const { from, blockNumber, networkName } = await getWeb3State();

  return {
    author: from.toLowerCase(),
    created_at: new Date().getTime(),
    family: http ? 'http' : networkName,
    id,
    sequence: blockNumber + 1,
    ...(!entity.isAddress ? { context: entity.id } : null),
    ...(!entity.isAddress ? { context_info: entity } : { author_info: entity }),
    ...(entity.isAddress ? { isFromAddress: true } : null),
  };
};

const sendClaim = (data, http) => (http ? httpClaim(data) : claim(data));

const httpClaim = async (data) => {
  const { web3, from } = await getWeb3State();
  const wrappedClaim = JSON.stringify({ data, creator: from.toLowerCase(), nonce: uuidv4() });
  const signatureValue = await web3.eth.personal.sign(wrappedClaim, from);
  const body = JSON.stringify({ data: wrappedClaim, signatureValue, signatureType: 'ethereum:personal:sign' });
  const response = await fetch(`${USERFEEDS_API_ADDRESS}/api/create-claim`, {
    method: 'POST',
    body,
    headers: {
      'Content-Type': 'application/json',
    },
  });
  const id = await response.text();
  return id;
};

const claim = async (data) => {
  const { from } = await getWeb3State();
  const contract = await getClaimContract();
  return new Promise((resolve, reject) => {
    contract.methods
      .post(JSON.stringify(data))
      .send({ from })
      .on('transactionHash', (transactionHash) => resolve(`claim:${transactionHash}:0`))
      .catch(reject);
  });
};

const claimWithValueTransfer = async (data, value, ownerAddress) => {
  const { from } = await getWeb3State();
  const contract = await getClaimWithValueTransferContract();
  return new Promise((resolve, reject) => {
    contract.methods
      .post(
        JSON.stringify(data),
        [ownerAddress.toLowerCase(), INTERFACE_BOOST_ADDRESS.toLowerCase()],
        [new BN(value).sub(new BN(value).divn(10)).toString(10), new BN(value).divn(10).toString(10)],
      )
      .send({ from, value })
      .on('transactionHash', (transactionHash) => resolve(transactionHash))
      .catch(reject);
  });
};

export const setApprove = async (erc20, value, spenderContract) => {
  const spender = spenderContract || claimWithTokenValueTransferContractAddressesForNetworkId[1];
  const { from } = await getWeb3State();
  const contract = await getErc20Contract(erc20);
  const result = await contract.methods.allowance(from, spender).call();
  const allowance = new BN(result);
  if (allowance.gte(new BN(value))) {
    return Promise.resolve(true);
  }
  return contract.methods.approve(spender, new BN(value).sub(allowance)).send({ from });
};

export const transferEth = async (to, value) => {
  const web3 = await getWeb3();
  const { from } = await getWeb3State();

  return new Promise((resolve, reject) => {
    const promiEvent = web3.eth.sendTransaction({ from, to, value: toWei(value, 18) });
    promiEvent.on('error', reject);
    promiEvent.on('transactionHash', resolve);
  });
};

export const transferErc20 = async (erc20, to, value) => {
  const { from } = await getWeb3State();
  const contract = await getErc20Contract(erc20);

  const decimals = await contract.methods.decimals().call();

  return new Promise((resolve, reject) => {
    const promiEvent = contract.methods.transfer(to, toWei(value, decimals)).send({ from });
    promiEvent.on('error', reject);
    promiEvent.on('transactionHash', resolve);
  });
};

export const transferErc721 = async (erc721, to, value) => {
  const { from } = await getWeb3State();
  const contract = await getErc721Contract(erc721);

  console.log(erc721);

  const methods = (addr, from, to, value) => {
    const data = {
      default: contract.methods.transfer(to, value),
      '0x79986af15539de2db9a5086382daeda917a9cf0c': contract.methods.transferFrom(from, to, value),
      '0xcfbc9103362aec4ce3089f155c2da2eea1cb7602': contract.methods.transferFrom(from, to, value),
      '0xd4202b234c15255bf0511d3380e83bda9172a72b': contract.methods.transferFrom(from, to, value),
      '0xc70be5b7c19529ef642d16c10dfe91c58b5c3bf0': contract.methods.transferFrom(from, to, value),
      '0xdcaad9fd9a74144d226dbf94ce6162ca9f09ed7e': contract.methods.transferFrom(from, to, value),
      '0x323a3e1693e7a0959f65972f3bf2dfcb93239dfe': contract.methods.transferFrom(from, to, value),
      '0xf5b0a3efb8e8e4c201e2a935f110eaaf3ffecb8d': contract.methods.transferFrom(from, to, value),
      '0xdde2d979e8d39bb8416eafcfc1758f3cab2c9c72': contract.methods.transferFrom(from, to, value),
      /*'0x71c118b00759b0851785642541ceb0f4ceea0bd5': contract.methods.transfer(to, value),
      '0x7fdcd2a1e52f10c28cb7732f46393e297ecadda1': contract.methods.transfer(to, value),
      '0xd73be539d6b2076bab83ca6ba62dfe189abc6bbe': contract.methods.transfer(to, value),
      */
    };
    return data[addr.toLowerCase()] || data['default'];
  };

  const transfer = methods(erc721, from, to, value);

  console.log(transfer);

  return new Promise((resolve, reject) => {
    const promiEvent = transfer.send({ from });
    promiEvent.on('error', reject);
    promiEvent.on('transactionHash', resolve);
  });
};

export const deployERC20 = async ({ name, symbol, decimals, totalSupply, onTransactionHash, onReceipt }) => {
  const web3 = await getWeb3();
  const { from, networkName } = await getWeb3State();
  const newContract = new web3.eth.Contract(erc20ContractAbi);
  const args = [name, symbol, decimals, totalSupply, '0x6be450972b30891b16c8588dcbc10c8c2aef04da', 100];

  return new Promise((resolve, reject) => {
    const promiEvent = newContract.deploy({ data: `0x${ERC20Bytecode.object}`, arguments: args }).send({ from });
    promiEvent.on('error', reject);
    promiEvent.on('transactionHash', onTransactionHash);
    promiEvent.on('receipt', onReceipt);
    promiEvent.on('confirmation', resolve);
  });
};

const claimWithTokenValueTransfer = async (data, value, ownerAddress, erc20) => {
  const { from } = await getWeb3State();
  const contract = await getClaimWithTokenValueTransferContract();
  return new Promise((resolve, reject) => {
    contract.methods
      .post(JSON.stringify(data), [ownerAddress.toLowerCase(), INTERFACE_BOOST_ADDRESS.toLowerCase()], erc20, [
        new BN(value).sub(new BN(value).divn(10)).toString(10),
        new BN(value).divn(10).toString(10),
      ])
      .send({ from })
      .on('transactionHash', (transactionHash) => resolve(transactionHash))
      .catch(reject);
  });
};

export const claimWithMultiValueTransfer = async (data, recipients, values, value) => {
  const { from } = await getWeb3State();
  const contract = await getClaimWithConfigurableValueMultiTransferContract();
  return new Promise((resolve, reject) => {
    contract.methods
      .post(JSON.stringify(data), recipients, values.map((i) => new BN(i).toString(10)))
      .send({ from, value: new BN(value).toString(10) })
      .on('transactionHash', (transactionHash) => resolve(transactionHash))
      .catch(reject);
  });
};

export const claimWithTokenMultiValueTransfer = async (data, recipients, tokenAddress, values) => {
  const { from } = await getWeb3State();
  const contract = await getClaimWithConfigurableTokenValueMultiTransferContract();
  return new Promise((resolve, reject) => {
    contract.methods
      .post(JSON.stringify(data), recipients, tokenAddress, values.map((i) => new BN(i).toString(10)))
      .send({ from })
      .on('transactionHash', (transactionHash) => resolve(transactionHash))
      .catch(reject);
  });
};

export const sendMessage = async (entity, message, { http } = {}) => {
  const data = {
    claim: { target: message },
    ...(!entity.isAddress ? { context: entity.id } : null),
    credits: getCreditsData(),
  };
  const id = await sendClaim(data, http);
  const feedItemBase = await createFeedItemBase(id, entity, http);

  return {
    ...feedItemBase,
    target: message,
    type: 'regular',
    likes: [],
    replies: [],
  };
};

export const reply = async (entity, message, to, { http } = {}) => {
  const data = {
    type: ['about'],
    claim: { target: message, about: to },
    ...(!entity.isAddress ? { context: entity.id } : null),
    credits: getCreditsData(),
  };
  const id = await sendClaim(data, http);
  const feedItemBase = await createFeedItemBase(id, entity, http);
  return { ...feedItemBase, target: message, likes: [] };
};

export const writeTo = async (entity, message, entityTo, { http } = {}) => {
  const data = {
    type: ['about'],
    claim: { target: message, about: entityTo.id },
    ...(!entity.isAddress ? { context: entity.id } : null),
    credits: getCreditsData(),
  };
  const id = await sendClaim(data, http);
  const feedItemBase = await createFeedItemBase(id, entity, http);
  return {
    ...feedItemBase,
    about: entityTo.id,
    about_info: entityTo,
    target: message,
    type: 'post_to',
  };
};

export const writeAbout = async (entity, message, club, { http } = {}) => {
  const about = `${club.network}:${club.address}`;
  const data = {
    type: ['about'],
    claim: { target: message, about },
    ...(!entity.isAddress ? { context: entity.id } : null),
    credits: getCreditsData(),
  };
  const id = await sendClaim(data, http);
  const feedItemBase = await createFeedItemBase(id, entity, http);
  return {
    ...feedItemBase,
    about,
    about_info: club,
    target: message,
    type: 'post_club',
  };
};

export const react = async (entity, to, { http } = {}) => {
  const data = {
    type: ['labels'],
    claim: { target: to, labels: ['like'] },
    ...(!entity.isAddress ? { context: entity.id } : null),
    credits: getCreditsData(),
  };
  const id = await sendClaim(data, http);
  const feedItemBase = await createFeedItemBase(id, entity, http);
  return { ...feedItemBase, target: { id: to } };
};

export const label = async (entity, message, labelType, { http } = {}) => {
  const data = {
    type: ['labels'],
    claim: { target: message, labels: [labelType] },
    ...(!entity.isAddress ? { context: entity.id } : null),
    credits: getCreditsData(),
  };
  const id = await sendClaim(data, http);
  const feedItemBase = await createFeedItemBase(id, entity, http);
  return {
    ...feedItemBase,
    target: message,
    type: 'social',
    label: labelType,
  };
};

export const boost = async (who, whom, value, asset) => {
  const { networkName } = await getWeb3State();
  let ownerAddress;
  if (isAddress(whom)) {
    ownerAddress = whom;
  } else {
    ownerAddress = (await getEntityData(whom)).owner;
  }

  const data = {
    type: ['about'],
    claim: { target: who.id, about: whom },
    credits: getCreditsData(),
  };

  let transactionHash;
  if (asset === 'ethereum') {
    transactionHash = await claimWithValueTransfer(data, value, ownerAddress);
  } else {
    const [, erc20] = asset.split(':');
    transactionHash = await claimWithTokenValueTransfer(data, value, ownerAddress, erc20);
  }

  return { transactionHash, networkName };
};

export const getHttpClaimDetails = async ({ id }) => {
  return fetch(`${USERFEEDS_API_ADDRESS}/api/verify-claim?signatureValue=${id.split(':')[1]}`).then((res) =>
    res.json(),
  );
};

export const mintTokens = async (signature) => {
  const { from } = await getWeb3State();
  await mintTokensInContract(signature, from);
};

const getTransactionSignature = async (from) => {
  return fetch(`https://mint-signature-signer.herokuapp.com/get-mint-signature?address=${from}`).then((res) =>
    res.json(),
  );
};

export const getAvailableTokensWithSignature = async () => {
  const { from } = await getWeb3State();
  const { max, v, r, s } = await getTransactionSignature(from);
  const mintedAmount = await getMintedTokens(from);
  return { max: max - mintedAmount, v, r, s };
};

const mintTokensInContract = async ({ max, v, r, s }, from) => {
  const contract = await getMintTokensContract();
  await contract.methods.mintUsingSignature(max, v, r, s).send({ from });
};

const getMintTokensContract = async () => {
  const web3 = await getWeb3();
  const contractAddress = '0x6f3b2f2100875409c5c011bc3bb97ea6e0f671db';
  const contract = new web3.eth.Contract(mintTokensContractAbi, contractAddress);
  contract.setProvider(web3.currentProvider);
  return contract;
};

const getMintedTokens = async (from) => {
  const contract = await getMintTokensContract();
  return await contract.methods.mintedBy(from).call();
};
