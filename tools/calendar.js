export async function createEvent(data) {
  return {
    success: true,
    tool: "calendar.create",
    data
  };
}