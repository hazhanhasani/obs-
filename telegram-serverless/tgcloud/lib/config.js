// Change this to the numeric Telegram user ID of the bot owner before deployment.
// Zero deliberately locks all privileged controls until configured.
export const OWNER_USER_ID = 0;
export const isOwner = id => OWNER_USER_ID > 0 && Number.isSafeInteger(id) && id === OWNER_USER_ID;
