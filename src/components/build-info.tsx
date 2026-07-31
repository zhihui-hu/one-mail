import { format } from "date-fns";
import { useEffect } from "react";

import pkg from "../../package.json";

export default function BuildInfo(): null {
  useEffect(() => {
    const print = (key: string, value: string): void =>
      console.log(
        `%c ${key} %c ${value} %c `,
        "background:#20232a;padding:1px;border-radius:3px 0 0 3px;color:#fff",
        "background:#61dafb;padding:1px;border-radius:0 3px 3px 0;color:#20232a;font-weight:bold",
        "background:transparent",
      );

    print(pkg.name, pkg.version);
    print(
      "build time",
      format(new Date(__APP_BUILD_TIME__), "yyyy-MM-dd HH:mm"),
    );
    print("environment", import.meta.env.VITE_APP_ENV);
  }, []);

  return null;
}
