const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand
} = require("@aws-sdk/lib-dynamodb");

require("dotenv").config();

const client = new DynamoDBClient({
  region: process.env.AWS_REGION
});

const docClient = DynamoDBDocumentClient.from(client);

const TABLE_NAME = process.env.DYNAMODB_MESSAGES_TABLE;
const SUITES_TABLE_NAME = process.env.DYNAMODB_SUITES_TABLE || TABLE_NAME;
const SUITE_HISTORY_TABLE_NAME = process.env.DYNAMODB_SUITE_HISTORY_TABLE || TABLE_NAME;
const SUITE_STATUS_TIMESTAMP = "SUITE_STATUS";
const VALID_SUITE_STATUSES = new Set([
  "waiting",
  "active",
  "pending",
  "resolved",
  "checkout",
  "offline"
]);
const DEFAULT_SUITE_STATUS = "waiting";
const DEFAULT_SUITE_PRIORITY = "normal";

async function saveMessage(message) {
  const command = new PutCommand({
    TableName: TABLE_NAME,
    Item: message
  });

  await docClient.send(command);
  return message;
}

async function getMessagesByRoom(roomId) {
  const command = new QueryCommand({
    TableName: TABLE_NAME,
    KeyConditionExpression: "roomId = :roomId",
    ExpressionAttributeValues: {
      ":roomId": roomId
    },
    ScanIndexForward: true
  });

  const result = await docClient.send(command);
  return (result.Items || []).filter((item) => !item.recordType);
}

function normalizeSuiteId(suiteId) {
  return suiteId.replace(/^room-/, "");
}

function validateSuiteStatus(status) {
  if (!VALID_SUITE_STATUSES.has(status)) {
    throw new Error(`Invalid suite status: ${status}`);
  }
}

function toSuiteStatusResponse(item) {
  return {
    suiteId: item.suiteId,
    roomId: item.roomId,
    status: item.status,
    updatedBy: item.updatedBy,
    updatedAt: item.updatedAt,
    createdAt: item.createdAt,
    priority: item.priority || DEFAULT_SUITE_PRIORITY,
    vip: Boolean(item.vip),
    lastMessageAt: item.lastMessageAt || null,
    unresolvedCount: Number(item.unresolvedCount || 0)
  };
}

function buildSuiteStatusItem({
  suiteId,
  roomId,
  status,
  updatedBy,
  priority,
  vip,
  lastMessageAt,
  unresolvedCount,
  previousSuiteStatus
}) {
  const updatedAt = new Date().toISOString();
  const normalizedSuiteId = normalizeSuiteId(suiteId);
  const resolvedRoomId = roomId || `room-${normalizedSuiteId}`;
  const createdAt = previousSuiteStatus?.createdAt || updatedAt;
  const resolvedStatus = status || previousSuiteStatus?.status || DEFAULT_SUITE_STATUS;

  validateSuiteStatus(resolvedStatus);

  if (process.env.DYNAMODB_SUITES_TABLE) {
    return {
      suiteId: normalizedSuiteId,
      roomId: resolvedRoomId,
      status: resolvedStatus,
      updatedBy: updatedBy || previousSuiteStatus?.updatedBy || "system",
      updatedAt,
      createdAt,
      priority: priority || previousSuiteStatus?.priority || DEFAULT_SUITE_PRIORITY,
      vip: typeof vip === "boolean" ? vip : Boolean(previousSuiteStatus?.vip),
      lastMessageAt: lastMessageAt || previousSuiteStatus?.lastMessageAt || null,
      unresolvedCount:
        typeof unresolvedCount === "number"
          ? unresolvedCount
          : Number(previousSuiteStatus?.unresolvedCount || 0)
    };
  }

  return {
    roomId: normalizedSuiteId,
    timestamp: SUITE_STATUS_TIMESTAMP,
    recordType: "suiteStatus",
    suiteId: normalizedSuiteId,
    displayRoomId: resolvedRoomId,
    status: resolvedStatus,
    updatedBy: updatedBy || previousSuiteStatus?.updatedBy || "system",
    updatedAt,
    createdAt,
    priority: priority || previousSuiteStatus?.priority || DEFAULT_SUITE_PRIORITY,
    vip: typeof vip === "boolean" ? vip : Boolean(previousSuiteStatus?.vip),
    lastMessageAt: lastMessageAt || previousSuiteStatus?.lastMessageAt || null,
    unresolvedCount:
      typeof unresolvedCount === "number"
        ? unresolvedCount
        : Number(previousSuiteStatus?.unresolvedCount || 0)
  };
}

async function saveSuiteStatus(suiteStatus) {
  const suiteId = normalizeSuiteId(suiteStatus.suiteId);
  const previousSuiteStatus = await getSuiteStatus(suiteId);
  const item = buildSuiteStatusItem({
    ...suiteStatus,
    suiteId,
    previousSuiteStatus
  });

  const command = new PutCommand({
    TableName: SUITES_TABLE_NAME,
    Item: item
  });

  await docClient.send(command);

  const savedSuiteStatus = toSuiteStatusResponse(item);

  if (previousSuiteStatus?.status !== savedSuiteStatus.status) {
    await saveSuiteActivity({
      suiteId,
      type: "statusChanged",
      previousStatus: previousSuiteStatus?.status || null,
      newStatus: savedSuiteStatus.status,
      updatedBy: savedSuiteStatus.updatedBy,
      timestamp: savedSuiteStatus.updatedAt
    });
  }

  return savedSuiteStatus;
}

async function getSuiteStatus(suiteId) {
  const normalizedSuiteId = normalizeSuiteId(suiteId);
  const key = process.env.DYNAMODB_SUITES_TABLE
    ? { suiteId: normalizedSuiteId }
    : { roomId: normalizedSuiteId, timestamp: SUITE_STATUS_TIMESTAMP };

  const command = new GetCommand({
    TableName: SUITES_TABLE_NAME,
    Key: key
  });

  const result = await docClient.send(command);

  if (!result.Item) {
    return null;
  }

  return toSuiteStatusResponse({
    ...result.Item,
    roomId: result.Item.displayRoomId || result.Item.roomId
  });
}

async function saveSuiteActivity({
  suiteId,
  type,
  previousStatus,
  newStatus,
  updatedBy,
  timestamp
}) {
  const normalizedSuiteId = normalizeSuiteId(suiteId);
  const activityTimestamp = timestamp || new Date().toISOString();

  const item = process.env.DYNAMODB_SUITE_HISTORY_TABLE
    ? {
        suiteId: normalizedSuiteId,
        timestamp: activityTimestamp,
        type,
        previousStatus,
        newStatus,
        updatedBy
      }
    : {
        roomId: normalizedSuiteId,
        timestamp: `ACTIVITY#${activityTimestamp}`,
        recordType: "suiteActivity",
        suiteId: normalizedSuiteId,
        type,
        previousStatus,
        newStatus,
        updatedBy,
        activityAt: activityTimestamp
      };

  const command = new PutCommand({
    TableName: SUITE_HISTORY_TABLE_NAME,
    Item: item
  });

  await docClient.send(command);
  return item;
}

async function updateSuiteMessageActivity({ roomId, sender, timestamp }) {
  const suiteId = normalizeSuiteId(roomId);
  const currentSuiteStatus = await getSuiteStatus(suiteId);
  const currentUnresolvedCount = Number(currentSuiteStatus?.unresolvedCount || 0);
  const isGuestMessage = sender === "guest";

  return saveSuiteStatus({
    suiteId,
    roomId,
    status: isGuestMessage && !currentSuiteStatus ? "waiting" : currentSuiteStatus?.status,
    updatedBy: sender,
    lastMessageAt: timestamp,
    unresolvedCount: isGuestMessage ? currentUnresolvedCount + 1 : 0
  });
}

function getValidSuiteStatuses() {
  return Array.from(VALID_SUITE_STATUSES);
}

function sortSuitesForQueue(suites) {
  const statusWeight = {
    waiting: 0,
    pending: 1,
    active: 2,
    checkout: 3,
    resolved: 4,
    offline: 5
  };

  return suites.sort((a, b) => {
    if (statusWeight[a.status] !== statusWeight[b.status]) {
      return statusWeight[a.status] - statusWeight[b.status];
    }

    if (b.unresolvedCount !== a.unresolvedCount) {
      return b.unresolvedCount - a.unresolvedCount;
    }

    if (Number(b.vip) !== Number(a.vip)) {
      return Number(b.vip) - Number(a.vip);
    }

    return new Date(a.lastMessageAt || 0) - new Date(b.lastMessageAt || 0);
  });
}

module.exports = {
  saveMessage,
  getMessagesByRoom,
  saveSuiteStatus,
  getSuiteStatus,
  updateSuiteMessageActivity,
  getValidSuiteStatuses,
  sortSuitesForQueue
};
