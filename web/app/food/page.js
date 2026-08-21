import { redirect } from "next/navigation";


// /food became the Food section of /health. The route stays so nothing that
// already points here breaks — a home-screen shortcut, an old push payload,
// a link in a brief — and forwards with its day intact.
export default async function Food({ searchParams }) {

  const params = await searchParams;

  const date = /^\d{4}-\d{2}-\d{2}$/.test(params?.date || "") ? `?date=${params.date}` : "";

  redirect(`/health${date}`);

}
