export async function createTask(data) {
  return {
    success: true,
    tool: "tasks.create",
    data
  };
}