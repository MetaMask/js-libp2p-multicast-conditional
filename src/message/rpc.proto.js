'use strict'
module.exports = `
message RPC {
  repeated SubOpts subscriptions = 1;
  repeated Message msgs = 2;

  message SubOpts {
    optional bool subscribe = 1; // subscribe or unsubcribe
    optional string topicCID = 2;
  }

  message Message {
    optional bytes from = 1;
    optional bytes data = 2;
    optional bytes seqno = 3;
    optional int32 hops = 4;
    repeated string topicIDs = 5;
  }
}`
