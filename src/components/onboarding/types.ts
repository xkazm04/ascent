export interface OrgRepo {
  fullName: string;
  owner: string;
  name: string;
  private: boolean;
  language: string | null;
  stars: number;
  pushedAt: string | null;
}
