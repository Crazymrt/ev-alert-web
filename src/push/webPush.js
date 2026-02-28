import { getToken, onMessage } from "firebase/messaging";
import { getWebMessaging } from "../firebase";

export async function initWebPush() {
  const messaging = await getWebMessaging();

  if (!messaging) {
    console.log("Web push not supported in this environment.");
    return null;
  }

  const vapidKey = process.env.REACT_APP_FIREBASE_VAPID_KEY;

  if (!vapidKey) {
    console.warn("Missing REACT_APP_FIREBASE_VAPID_KEY");
    return null;
  }

  const token = await getToken(messaging, { vapidKey });
  console.log("Web push token:", token);

  // Listen for messages while app is open
  onMessage(messaging, (payload) => {
    console.log("Foreground message:", payload);
  });

  return token;
}