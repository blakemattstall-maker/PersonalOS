import { SkeletonPage } from "../ui.js";

export default function Loading() {
  return <SkeletonPage title="Connections" cards={2} lines={4} />;
}
