# Déploiement sur le serveur

Déployé le 12 novembre 2026 sur `51.15.129.189`.

| Application | Adresse | Exécution |
| --- | --- | --- |
| FRAM | http://51.15.129.189/ | Nginx :80 → conteneur `fram-voyage`, boucle locale :3000 |
| Mosaïque existante | http://51.15.129.189:8081/ | Nginx :8081 → service `mosaique` inchangé, boucle locale :8765 |
| Crux existant | http://51.15.129.189:8080/ | Conteneur existant inchangé |

## Fichiers du serveur

- Version applicative : `/opt/fram/releases/20261112-9e08b233cb3c`
- Lien actif : `/opt/fram/current`
- Configuration privée : `/opt/fram/shared/.env` (root, mode 600)
- Embeddings persistants : `/opt/fram/shared/cache`
- Configuration Nginx FRAM : `/etc/nginx/sites-available/fram`
- Sauvegarde avant bascule : `/opt/fram/backups/before-20261112-9e08b233cb3c`

La clé Mistral a été transférée par SSH dans le fichier privé, jamais dans l’image Docker ni les fichiers publics. Les visiteurs utilisent cette configuration serveur. L’application est publiée en HTTP sur le port principal ; aucun nom de domaine ni certificat HTTPS n’a été configuré dans cette intervention.

Le conteneur redémarre automatiquement (`unless-stopped`), écrit uniquement dans son cache et possède un contrôle de santé. Nginx désactive la mise en tampon du flux de conversation et limite les requêtes de recherche par adresse IP. Les services et processus de Mosaïque et Crux ont été conservés.

## Exploitation

Après `ssh root@51.15.129.189` :

```sh
docker ps
docker logs --tail 50 fram-voyage
docker restart fram-voyage
nginx -t
```

Pour changer la clé, éditez `/opt/fram/shared/.env` sur le serveur, puis recréez le conteneur afin de recharger son environnement :

```sh
cd /opt/fram/current
FRAM_RELEASE=20261112-9e08b233cb3c docker compose -p fram -f deploy/compose.production.yaml up -d --force-recreate --wait
```

## Rétablir l’ancien site sur le port principal

Cette opération remet la mosaïque sur :80, désactive le routage public de FRAM et retire le routage mosaïque de :8081. Le conteneur FRAM et les données restent conservés.

```sh
cp -a /opt/fram/backups/before-20261112-9e08b233cb3c/mosaique.original /etc/nginx/sites-available/mosaique
unlink /etc/nginx/sites-enabled/fram
nginx -t && systemctl reload nginx
```

Le script `cutover.sh` est volontairement prévu pour une première bascule : il refuse d’écraser une installation ou une sauvegarde existante. Il sauvegarde l’ancienne configuration et la restaure automatiquement si ses vérifications échouent. Ne le relancez pas sur l’installation active.

## Vérifications réalisées

- Les 23 tests ont passé dans l’image Node.js 22, sans accès réseau externe pour les tests.
- Une recherche Mistral réelle a validé l’extraction, les embeddings et le classement depuis le conteneur.
- Les trois adresses publiques ont répondu en HTTP 200 depuis l’extérieur du serveur.
- L’API publique, un filtre direct avec l’origine navigateur et le flux NDJSON ont été vérifiés.
- L’ancienne page Mosaïque est identique octet pour octet après déplacement ; son processus et le conteneur Crux n’ont pas changé.
- Le fichier `.env` répond 404 depuis le web.
- Le site et le formulaire de destination ont été vérifiés dans le navigateur à l’adresse publique.
