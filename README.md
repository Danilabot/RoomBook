# RoomBook

Бронирование переговорных с расписанием по Москве, личной историей, уведомлениями и управлением комнатами. Приложение работает через браузер и использует Keycloak для входа.

## Локальный запуск с Notes и Google

По умолчанию RoomBook использует существующий realm `notes` в Keycloak проекта Notes. Если вы уже вошли в Notes, тот же сеанс Keycloak позволяет войти в RoomBook. На странице входа доступен существующий провайдер **Google**.

Нужны Docker с Compose v2, Node.js 24, `openssl` и настроенный проект `notes-api` с собственным `.env`. Из корня RoomBook выполните команды ниже. Если репозитории лежат в разных каталогах, измените `notes_dir`.

```sh
room_dir=$(pwd)
notes_dir=$(cd ../notes-api && pwd)
test -f .env || ./scripts/init-env.sh
docker network inspect roombook-notes-sso >/dev/null 2>&1 ||
  docker network create --internal roombook-notes-sso

(
  cd "$notes_dir"
  docker compose -p notes-api -f compose.full.yaml -f compose.keycloak.yaml \
    -f compose.cutover.yaml -f "$room_dir/deploy/notes-sso.network.yaml" \
    up -d --wait --wait-timeout 300
)

node scripts/setup-shared-sso.mjs "$notes_dir"
docker compose up -d --build --wait --wait-timeout 300
docker compose run --rm --no-deps migrate npm run seed:demo
```

При перезапуске Notes используйте тот же список файлов Compose, чтобы Keycloak оставался доступен RoomBook. Перед переключением уже запущенного автономного RoomBook на общий realm остановите автономные контейнеры командой `docker compose -f compose.yaml -f compose.standalone.yaml down`. Именованные тома и бронирования сохраняются.

Скрипт перед настройкой сохраняет резервную копию БД Keycloak в `.local/keycloak-backups/` с правами `0600`. Он использует администратора Keycloak из локального файла Notes и отдельный секрет RoomBook в его `.env`. Повторный запуск сохраняет существующие настройки Notes и Google. Храните эти файлы локально. Если скрипт был принудительно остановлен, удаляйте оставшийся `.local/setup-shared-sso.lock` только после проверки, что другого запуска нет.

Откройте [RoomBook](http://localhost:3100) и нажмите «Войти через SSO». Используйте тот же аккаунт, что и в [Notes](http://localhost:3000). Пользователи realm получают роль `employee` клиента `roombook-api`. Чтобы назначить администратора RoomBook, откройте [консоль Keycloak](http://localhost:8080/admin/), выберите realm `notes` и добавьте конкретному пользователю роль `admin` клиента `roombook-api` в **Role mapping**. Роли Notes и RoomBook назначаются отдельно.

Брони и история, созданные в автономном режиме, остаются привязаны к исходным учётным записям. Совпадение email между realm не объединяет профили. При смене realm нужно войти заново.

## Автономный демостенд

Этот режим использует отдельный Keycloak и локальные демоаккаунты. Если общий режим запущен, остановите его через `docker compose down`. Из корня репозитория выполните:

```sh
test -f .env || ./scripts/init-env.sh
docker compose -f compose.yaml -f compose.standalone.yaml up -d --build --wait --wait-timeout 300
docker compose -f compose.yaml -f compose.standalone.yaml run --rm --no-deps migrate npm run seed:demo
```

Скрипт создаёт `.env` с правами `0600` и случайными ключами. Команда с демоданными добавляет три комнаты и сохраняет сделанные в них изменения при повторном запуске.

- [RoomBook](http://localhost:3100) и [проверка API](http://localhost:3100/api/health).
- [Консоль автономного Keycloak](http://localhost:8180/admin/). Имя `keycloak-admin`, пароль из `KEYCLOAK_ADMIN_PASSWORD` в `.env`.

| Имя пользователя | Пароль в `.env` | Возможности |
| --- | --- | --- |
| `employee` | `DEMO_EMPLOYEE_PASSWORD` | Каталог, расписание, свои бронирования и уведомления |
| `admin` | `DEMO_ADMIN_PASSWORD` | Возможности сотрудника, управление комнатами, обслуживание и отмена чужих бронирований с причиной |

Используйте `localhost` для зарегистрированных URL возврата. При выходе Keycloak может попросить подтвердить завершение SSO-сессии.

Останавливайте автономный режим командой `docker compose -f compose.yaml -f compose.standalone.yaml down`. Для повторного запуска используйте ту же команду `up` с обоими файлами. Миграции выполняются до старта API и обработчика напоминаний. Keycloak импортирует realm только при его отсутствии.

Напоминания появляются во входящих за 30 минут до начала бронирования. Обработчик проверяет очередь каждые 15 секунд и при ошибке повторяет доставку в следующем цикле.

## Проверка

Для backend и фронтенда нужны Node.js 24 и npm. Тесты backend используют отдельную БД, создают временные схемы и проверяют миграции, конкурирующие бронирования, авторизацию и очередь напоминаний.

```sh
docker run --rm -d --name roombook-test-db -p 127.0.0.1::5432 \
  -e POSTGRES_PASSWORD=roombook_test_only postgres:18
docker exec roombook-test-db pg_isready -h 127.0.0.1 -U postgres
# При ответе «no response» повторите pg_isready, пока БД не будет готова.
test_port=$(docker port roombook-test-db 5432/tcp | cut -d: -f2)
npm ci
TEST_DATABASE_URL="postgresql://postgres:roombook_test_only@127.0.0.1:${test_port}/postgres" npm test
docker stop roombook-test-db
npm ci --prefix web
npm run web:test
npm run web:build
```

Для проверки автономного Compose войдите сотрудником, откройте расписание любой демокомнаты, создайте бронь на будущий рабочий интервал (08:00–20:00 МСК), измените название в «Мои бронирования» и отмените её. Проверьте события во входящих и запись в истории. В той же сессии `GET /api/admin/bookings` вернёт `403`. После выхода `GET /api/auth/me` вернёт `401`. Войдите как `admin`, откройте «Управление» и создайте комнату. После остановки и нового запуска автономного стенда проверьте комнату и отменённую бронь в соответствующих аккаунтах.

## Google на автономном стенде

В общем режиме уже используется Google из Notes. Для автономного режима Google можно отдельно подключить в realm `roombook`. Для демостенда достаточно встроенных пользователей Keycloak. Для Google нужны собственные OAuth-учётные данные.

1. В консоли Keycloak выберите realm `roombook` → **Identity providers** → **Google**.
2. В Google Cloud настройте OAuth consent screen и создайте OAuth-клиент типа **Web application**. Добавьте точный **Redirect URI**, который показывает Keycloak. Для стенда с alias `google` это `http://localhost:8180/realms/roombook/broker/google/endpoint`. Если consent screen в режиме тестирования, добавьте нужный аккаунт в список тестовых пользователей.
3. Сохраните выданные Google Client ID и Client Secret в настройке провайдера в Keycloak.
4. При первом входе проверьте пользователя в Keycloak и назначьте ему через **Role mapping** клиентскую роль `employee` или `admin` клиента `roombook-api`. До назначения роли доступ к данным RoomBook закрыт.

[Инструкция Keycloak по подключению Google](https://www.keycloak.org/docs/26.5.7/server_admin/index.html#_google)

## Границы локальной конфигурации

RoomBook публикует веб-интерфейс на loopback. Порт общего Keycloak публикует Notes, а автономный режим публикует собственный порт Keycloak. Базы данных и NestJS доступны внутри сети Compose. Nginx передаёт `/api/` в NestJS через тот же браузерный origin. Сессия хранится на сервере, а браузер получает непрозрачную HttpOnly cookie. Изменяющие запросы проверяют точный `Origin` и CSRF-токен. Callback URL исключены из access-логов.

Для внешнего развёртывания настройте HTTPS для RoomBook и Keycloak, отключите `OIDC_ALLOW_LOCAL_HTTP` и замените `start-dev` на production-конфигурацию Keycloak. Согласуйте `APP_ORIGIN`, `OIDC_ISSUER`, `KC_HOSTNAME` и точные login/logout callback в клиенте `roombook-web`. При отдельном внутреннем HTTPS-адресе Keycloak укажите `OIDC_INTERNAL_ORIGIN`. Используйте отдельные эксплуатационные секреты и учётные записи. Сохраняйте тома обеих баз и отдельно защищайте `SESSION_ENCRYPTION_KEY`.
