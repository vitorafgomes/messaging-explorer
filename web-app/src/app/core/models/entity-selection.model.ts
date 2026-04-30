import { EntityType, TreeNode } from './tree-node.model';
import { QueueInfo } from './queue.model';
import { TopicInfo, SubscriptionInfo } from './topic.model';

export interface EntitySelection {
  type: EntityType;
  node: TreeNode;
  entity?: QueueInfo | TopicInfo | SubscriptionInfo;
}

export interface SelectionState {
  selection: EntitySelection | null;
  loading: boolean;
  error: string | null;
}
