import { ActivityList } from "../components/ActivityList";
import { api } from "../lib/api";
import { useBackendData } from "../lib/useBackendData";
import { cardClass } from "../styles";

const fetchActivity = () => api.getRecentActivity(50);

function ActivityLogsPage() {
  const activity = useBackendData(fetchActivity);
  return (
    <section className={cardClass}>
      <h2 className="m-0 mb-1 text-sm font-bold text-[#172033]">Operation history</h2>
      <p className="m-0 mb-4 text-xs text-[#788397]">The 50 most recent diagnostic and repair operations.</p>
      <ActivityList items={activity.data} loading={activity.loading} error={activity.error} />
    </section>
  );
}

export default ActivityLogsPage;
