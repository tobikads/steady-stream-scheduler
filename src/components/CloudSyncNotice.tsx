import { Link } from "@tanstack/react-router";
import { AlertCircle, LogIn, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export function CloudSyncNotice({
  message,
  onRetry,
  showSignIn,
}: {
  message?: string | null;
  onRetry?: () => void;
  showSignIn?: boolean;
}) {
  return (
    <Card className="p-4 border-amber-500/30 bg-amber-500/10 text-sm text-amber-800">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex gap-2">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <div>
            <div className="font-medium text-amber-900">Local mode</div>
            <p>
              {message
                ? `Cloud sync is unavailable, so this page is using local data. ${message}`
                : "You are working locally. Sign in to sync this planner with the cloud."}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {message && onRetry && (
            <Button type="button" variant="outline" size="sm" onClick={onRetry}>
              <RefreshCw className="size-3.5" />
              Try cloud again
            </Button>
          )}
          {showSignIn && (
            <Button asChild size="sm">
              <Link to="/login">
                <LogIn className="size-3.5" />
                Sign in
              </Link>
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}
