import ChatView from "@/components/ChatView";

export default async function ChatPage({ params }: { params: Promise<{ id: string }> }) {
  // Task data is fetched client-side; this page is a thin shell.
  await params;
  return <ChatView />;
}