export type EntityType = 'root' | 'category' | 'queue' | 'topic' | 'subscription';

export interface TreeNode {
  id: string;
  name: string;
  type: EntityType;
  icon: string;
  expandable: boolean;
  level: number;
  children?: TreeNode[];
  data?: QueueNodeData | TopicNodeData | SubscriptionNodeData;
  parent?: TreeNode;
}

export interface QueueNodeData {
  activeMessageCount: number;
  deadLetterMessageCount: number;
  sizeInBytes: number;
  status: string;
}

export interface TopicNodeData {
  subscriptionCount: number;
  sizeInBytes: number;
  status: string;
  // RabbitMQ pattern detection
  detectedPattern?: {
    pattern: number;
    confidence: number;
    reason: string;
  };
  patternDisplay?: string;
}

export interface SubscriptionNodeData {
  topicName: string;
  activeMessageCount: number;
  deadLetterMessageCount: number;
  status: string;
}

export interface FlatTreeNode {
  id: string;
  name: string;
  type: EntityType;
  icon: string;
  expandable: boolean;
  level: number;
  data?: QueueNodeData | TopicNodeData | SubscriptionNodeData;
}
