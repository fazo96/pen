# services.pen: pen as a systemd service. Construct's agents run as `user`
# with its home, so they find its Claude Code login and pi settings.
{ self }:
{
  config,
  lib,
  pkgs,
  ...
}:

let
  cfg = config.services.pen;
in
{
  options.services.pen = {
    enable = lib.mkEnableOption "pen, a mobile-first markdown editor for fiction";

    package = lib.mkOption {
      type = lib.types.package;
      default = (self.lib.packagesFor pkgs).pen;
      defaultText = lib.literalExpression "pen built with the system's nixpkgs";
      description = "The pen package.";
    };

    host = lib.mkOption {
      type = lib.types.str;
      default = "127.0.0.1";
      description = "Address to listen on.";
    };

    port = lib.mkOption {
      type = lib.types.port;
      default = 3000;
      description = "Port to listen on.";
    };

    dataDir = lib.mkOption {
      type = lib.types.path;
      default = "/var/lib/pen";
      description = "The library: books, the lock, Construct's state (PEN_DIR).";
    };

    cacheDir = lib.mkOption {
      type = lib.types.path;
      default = "/var/cache/pen";
      description = "What pen can make again: the dictionary, grammar results (PEN_CACHE_DIR).";
    };

    user = lib.mkOption {
      type = lib.types.str;
      default = "pen";
      description = "User to run as. `pen` is created when left as is.";
    };

    group = lib.mkOption {
      type = lib.types.str;
      default = "pen";
      description = "Group to run as. `pen` is created when left as is.";
    };

    environment = lib.mkOption {
      type = lib.types.attrsOf lib.types.str;
      default = { };
      example = {
        PEN_AI = "off";
      };
      description = "Extra environment variables.";
    };

    environmentFile = lib.mkOption {
      type = lib.types.nullOr lib.types.path;
      default = null;
      description = "File with secrets such as ANTHROPIC_API_KEY, kept out of the store.";
    };
  };

  config = lib.mkIf cfg.enable {
    users.users = lib.mkIf (cfg.user == "pen") {
      pen = {
        isSystemUser = true;
        group = cfg.group;
        home = cfg.dataDir;
      };
    };
    users.groups = lib.mkIf (cfg.group == "pen") { pen = { }; };

    systemd.tmpfiles.settings."10-pen" = {
      ${cfg.dataDir}.d = {
        inherit (cfg) user group;
        mode = "0750";
      };
      ${cfg.cacheDir}.d = {
        inherit (cfg) user group;
        mode = "0750";
      };
    };

    systemd.services.pen = {
      description = "pen";
      wantedBy = [ "multi-user.target" ];
      after = [ "network.target" ];
      unitConfig.RequiresMountsFor = [
        cfg.dataDir
        cfg.cacheDir
      ];

      environment = {
        PEN_DIR = cfg.dataDir;
        PEN_CACHE_DIR = cfg.cacheDir;
        PEN_INTERNAL_URL = "http://127.0.0.1:${toString cfg.port}";
      }
      // cfg.environment;

      serviceConfig = {
        ExecStart = "${lib.getExe cfg.package} --hostname ${cfg.host} --port ${toString cfg.port}";
        User = cfg.user;
        Group = cfg.group;
        EnvironmentFile = lib.mkIf (cfg.environmentFile != null) cfg.environmentFile;
        Restart = "on-failure";
        RestartSec = 5;
        NoNewPrivileges = true;
        PrivateTmp = true;
        ProtectSystem = "full";
      };
    };
  };
}
