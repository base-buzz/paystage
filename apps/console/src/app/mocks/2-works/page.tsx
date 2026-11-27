import type { Metadata } from "next";

import "../../landing.css";
import "../mocks.css";

import { MocksStoryPage } from "@/components/mocks/MocksStoryPage";
import { storyFor } from "@/lib/mocks";

const story = storyFor(2);

export const metadata: Metadata = {
  title: `${story.n} · ${story.title}`,
  description: story.premise,
  robots: { index: false, follow: false, nocache: true },
};

export default function WorksStoryPage() {
  return <MocksStoryPage story={story} />;
}
