export type CreatePrivateConversationBody = {
  participantUserId: string;
};

export type CreateGroupConversationBody = {
  title: string;
  imageUrl?: string;
  participantUserIds: string[];
};

export type AddParticipantsBody = {
  userIds: string[];
};

export type UpdateGroupSettingsBody = {
  title?: string;
  description?: string;
  imageUrl?: string;
  joinApprovalMode?: 'OPEN' | 'ADMIN_APPROVAL' | 'INVITE_ONLY';
  memberAddMode?: 'ADMINS_ONLY' | 'ALL_MEMBERS';
  onlyAdminsCanPost?: boolean;
  onlyAdminsCanEditInfo?: boolean;
  maxMembers?: number;
};

export type MuteConversationBody = {
  muted: boolean;
  mutedUntil?: string; // ISO 8601 date string
};

export type ArchiveConversationBody = {
  archived: boolean;
};
