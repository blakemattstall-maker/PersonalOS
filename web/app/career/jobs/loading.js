import { SkeletonPage } from "../../ui.js";

export default function Loading() {
  return <SkeletonPage title="Jobs" cards={5} lines={2} />;
}
