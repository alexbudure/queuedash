import {
  createContext,
  type PropsWithChildren,
  useContext,
  useState,
} from "react";

type QueuedashAuthContextValue = {
  isSigningOut: boolean;
  signOut?: () => Promise<void>;
};

const QueuedashAuthContext = createContext<QueuedashAuthContextValue>({
  isSigningOut: false,
});

export const QueuedashAuthProvider = ({
  children,
  onSignOut,
}: PropsWithChildren<{
  onSignOut?: () => Promise<void>;
}>) => {
  const [isSigningOut, setIsSigningOut] = useState(false);
  const signOut = onSignOut
    ? async () => {
        setIsSigningOut(true);
        try {
          await onSignOut();
        } finally {
          setIsSigningOut(false);
        }
      }
    : undefined;

  return (
    <QueuedashAuthContext.Provider value={{ isSigningOut, signOut }}>
      {children}
    </QueuedashAuthContext.Provider>
  );
};

export const useQueuedashAuth = () => useContext(QueuedashAuthContext);
