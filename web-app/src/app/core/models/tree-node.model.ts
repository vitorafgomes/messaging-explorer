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
  /** The entity this queue forwards every message to; empty when it does not forward. */
  forwardTo?: string | null;
  /** RabbitMQ: how the queue is used, "Stream" or "Work queue, N consumers"; absent for any other queue. */
  patternDisplay?: string;
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
  /** RabbitMQ: the routing key of the binding this subscription stands for. */
  routingKey?: string;
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
