// Two plain lines under the skills list: a failed list read (shown IN PLACE of the list and of the
// empty state, so old rows never read as matches for the new filter) and the page-size notice.
// Pure markup, so no "use client".

export function SkillsListError({ message }: { message: string }) {
  return (
    <p role="alert" data-list-read-error className="type-body text-orange-300">
      {message}
    </p>
  );
}

export function SkillsTruncatedLine({ count }: { count: number }) {
  return (
    <p data-skills-truncated className="mt-2 type-body-sm text-slate-400">
      Showing the first {count} skills. Search or pick a category to narrow the list.
    </p>
  );
}
