import "@queuedash/ui/dist/styles.css";

import type { AppType } from "next/app";

const MyApp: AppType = ({ Component, pageProps }) => {
  return <Component {...pageProps} />;
};
export default MyApp;
