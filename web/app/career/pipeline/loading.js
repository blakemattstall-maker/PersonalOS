import { SkeletonPage } from "../../ui.js";

export default function Loading() {
  return <SkeletonPage title="Pipeline" cards={3} lines={4} />;
}
