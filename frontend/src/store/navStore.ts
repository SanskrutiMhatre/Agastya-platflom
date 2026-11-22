// Adapter: Agastya V1's screens read "the active project" from a global nav store.
// Here the project is whatever the URL says, which cannot go stale or disagree with the page.
import { useParams } from 'react-router-dom';

export function useNavStore(): { activeProjectId: string } {
  const { id } = useParams();
  return { activeProjectId: id ?? '' };
}
