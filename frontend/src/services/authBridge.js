import api from "../api/axios";
import { firebaseIdToken } from "./firebaseAuth";

export const exchangeFirebaseSession = async (firebaseUser, extraProfile = {}) => {
  const idToken = await firebaseIdToken(firebaseUser);
  const { data } = await api.post("/auth/firebase", {
    idToken,
    profile: {
      name: firebaseUser.displayName || "",
      email: firebaseUser.email || "",
      avatar: firebaseUser.photoURL || "",
      ...extraProfile,
    },
  });
  return data;
};
