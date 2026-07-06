import { appStoreUrl } from '../api';

interface Props {
  appId: string;
  name: string;
  developer: string | null;
  artworkUrl: string | null;
  country: string;
}

export function AppCell({ appId, name, developer, artworkUrl, country }: Props) {
  return (
    <div className="appcell">
      {artworkUrl ? <img src={artworkUrl} alt="" loading="lazy" /> : <span style={{ width: 26 }} />}
      <div className="names">
        <a href={appStoreUrl(appId, country)} target="_blank" rel="noreferrer">
          {name}
        </a>
        <div className="dev">{developer ?? '—'}</div>
      </div>
    </div>
  );
}
