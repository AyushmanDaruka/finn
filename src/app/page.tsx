import App from "@/components/App";
import digest from "../../data/digest.json";
import { RESEARCH_DEMO } from "@/data/portfolio";
import type { Digest } from "@/lib/types";

export default function Page() {
  return <App d={digest as unknown as Digest} demo={RESEARCH_DEMO} />;
}
