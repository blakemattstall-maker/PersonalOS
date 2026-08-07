import { SkeletonPage } from "../ui.js";

export default function Loading() {
  return <SkeletonPage title="News" cards={4} lines={2} />;
}
