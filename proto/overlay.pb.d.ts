import * as $protobuf from "protobufjs";
import Long = require("long");

/** Namespace overlay. */
export namespace overlay {

    /**
     * Properties of a Vec3.
     * @deprecated Use overlay.Vec3.$Properties instead.
     */
    interface IVec3 extends overlay.Vec3.$Properties {
    }

    /** Represents a Vec3. */
    class Vec3 {

        /**
         * Constructs a new Vec3.
         * @param [properties] Properties to set
         */
        constructor(properties?: overlay.Vec3.$Properties);

        /** Unknown fields preserved while decoding when enabled */
        $unknowns?: Uint8Array[];

        /** Vec3 x. */
        x: number;

        /** Vec3 y. */
        y: number;

        /** Vec3 z. */
        z: number;

        /**
         * Creates a new Vec3 instance using the specified properties.
         * @param [properties] Properties to set
         * @returns Vec3 instance
         */
        static create(properties: overlay.Vec3.$Shape): overlay.Vec3 & overlay.Vec3.$Shape;
        static create(properties?: overlay.Vec3.$Properties): overlay.Vec3;

        /**
         * Encodes the specified Vec3 message. Does not implicitly {@link overlay.Vec3.verify|verify} messages.
         * @param message Vec3 message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        static encode(message: overlay.Vec3.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified Vec3 message, length delimited. Does not implicitly {@link overlay.Vec3.verify|verify} messages.
         * @param message Vec3 message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        static encodeDelimited(message: overlay.Vec3.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a Vec3 message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns {overlay.Vec3 & overlay.Vec3.$Shape} Vec3
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): overlay.Vec3 & overlay.Vec3.$Shape;

        /**
         * Decodes a Vec3 message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns {overlay.Vec3 & overlay.Vec3.$Shape} Vec3
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): overlay.Vec3 & overlay.Vec3.$Shape;

        /**
         * Verifies a Vec3 message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates a Vec3 message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns Vec3
         */
        static fromObject(object: { [k: string]: any }): overlay.Vec3;

        /**
         * Creates a plain object from a Vec3 message. Also converts values to other types if specified.
         * @param message Vec3
         * @param [options] Conversion options
         * @returns Plain object
         */
        static toObject(message: overlay.Vec3, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this Vec3 to JSON.
         * @returns JSON object
         */
        toJSON(): { [k: string]: any };

        /**
         * Gets the type url for Vec3
         * @param [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
         * @returns The type url
         */
        static getTypeUrl(prefix?: string): string;
    }

    namespace Vec3 {

        /** Properties of a Vec3. */
        interface $Properties {

            /** Vec3 x */
            x?: (number|null);

            /** Vec3 y */
            y?: (number|null);

            /** Vec3 z */
            z?: (number|null);

            /** Unknown fields preserved while decoding when enabled */
            $unknowns?: Uint8Array[];
        }

        /** Shape of a Vec3. */
        type $Shape = overlay.Vec3.$Properties;
    }

    /**
     * Properties of a Player.
     * @deprecated Use overlay.Player.$Properties instead.
     */
    interface IPlayer extends overlay.Player.$Properties {
    }

    /** Represents a Player. */
    class Player {

        /**
         * Constructs a new Player.
         * @param [properties] Properties to set
         */
        constructor(properties?: overlay.Player.$Properties);

        /** Unknown fields preserved while decoding when enabled */
        $unknowns?: Uint8Array[];

        /** Player uId. */
        uId: string;

        /** Player playerName. */
        playerName?: (string|null);

        /** Player playerOpenId. */
        playerOpenId?: (string|null);

        /** Player picUrl. */
        picUrl?: (string|null);

        /** Player showPicUrl. */
        showPicUrl?: (string|null);

        /** Player character. */
        character?: (string|null);

        /** Player teamIdfromApi. */
        teamIdfromApi: number;

        /** Player teamId. */
        teamId: number;

        /** Player teamName. */
        teamName?: (string|null);

        /** Player location. */
        location?: (overlay.Vec3.$Properties|null);

        /** Player health. */
        health?: (number|null);

        /** Player healthMax. */
        healthMax?: (number|null);

        /** Player liveState. */
        liveState?: (number|null);

        /** Player isFiring. */
        isFiring?: (boolean|null);

        /** Player bHasDied. */
        bHasDied?: (boolean|null);

        /** Player isOutsideBlueCircle. */
        isOutsideBlueCircle?: (boolean|null);

        /** Player killNum. */
        killNum?: (number|null);

        /** Player killNumBeforeDie. */
        killNumBeforeDie?: (number|null);

        /** Player gotAirDropNum. */
        gotAirDropNum?: (number|null);

        /** Player maxKillDistance. */
        maxKillDistance?: (number|null);

        /** Player damage. */
        damage?: (number|null);

        /** Player killNumInVehicle. */
        killNumInVehicle?: (number|null);

        /** Player killNumByGrenade. */
        killNumByGrenade?: (number|null);

        /** Player rank. */
        rank?: (number|null);

        /** Player headShotNum. */
        headShotNum?: (number|null);

        /** Player survivalTime. */
        survivalTime?: (number|null);

        /** Player driveDistance. */
        driveDistance?: (number|null);

        /** Player marchDistance. */
        marchDistance?: (number|null);

        /** Player assists. */
        assists?: (number|null);

        /** Player knockouts. */
        knockouts?: (number|null);

        /** Player rescueTimes. */
        rescueTimes?: (number|null);

        /** Player useSmokeGrenadeNum. */
        useSmokeGrenadeNum?: (number|null);

        /** Player useFragGrenadeNum. */
        useFragGrenadeNum?: (number|null);

        /** Player useBurnGrenadeNum. */
        useBurnGrenadeNum?: (number|null);

        /** Player useFlashGrenadeNum. */
        useFlashGrenadeNum?: (number|null);

        /** Player contribution. */
        contribution?: (number|null);

        /** Player heal. */
        heal?: (number|null);

        /** Player docId. */
        docId: string;

        /**
         * Creates a new Player instance using the specified properties.
         * @param [properties] Properties to set
         * @returns Player instance
         */
        static create(properties: overlay.Player.$Shape): overlay.Player & overlay.Player.$Shape;
        static create(properties?: overlay.Player.$Properties): overlay.Player;

        /**
         * Encodes the specified Player message. Does not implicitly {@link overlay.Player.verify|verify} messages.
         * @param message Player message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        static encode(message: overlay.Player.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified Player message, length delimited. Does not implicitly {@link overlay.Player.verify|verify} messages.
         * @param message Player message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        static encodeDelimited(message: overlay.Player.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a Player message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns {overlay.Player & overlay.Player.$Shape} Player
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): overlay.Player & overlay.Player.$Shape;

        /**
         * Decodes a Player message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns {overlay.Player & overlay.Player.$Shape} Player
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): overlay.Player & overlay.Player.$Shape;

        /**
         * Verifies a Player message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates a Player message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns Player
         */
        static fromObject(object: { [k: string]: any }): overlay.Player;

        /**
         * Creates a plain object from a Player message. Also converts values to other types if specified.
         * @param message Player
         * @param [options] Conversion options
         * @returns Plain object
         */
        static toObject(message: overlay.Player, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this Player to JSON.
         * @returns JSON object
         */
        toJSON(): { [k: string]: any };

        /**
         * Gets the type url for Player
         * @param [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
         * @returns The type url
         */
        static getTypeUrl(prefix?: string): string;
    }

    namespace Player {

        /** Properties of a Player. */
        interface $Properties {

            /** Player uId */
            uId?: (string|null);

            /** Player playerName */
            playerName?: (string|null);

            /** Player playerOpenId */
            playerOpenId?: (string|null);

            /** Player picUrl */
            picUrl?: (string|null);

            /** Player showPicUrl */
            showPicUrl?: (string|null);

            /** Player character */
            character?: (string|null);

            /** Player teamIdfromApi */
            teamIdfromApi?: (number|null);

            /** Player teamId */
            teamId?: (number|null);

            /** Player teamName */
            teamName?: (string|null);

            /** Player location */
            location?: (overlay.Vec3.$Properties|null);

            /** Player health */
            health?: (number|null);

            /** Player healthMax */
            healthMax?: (number|null);

            /** Player liveState */
            liveState?: (number|null);

            /** Player isFiring */
            isFiring?: (boolean|null);

            /** Player bHasDied */
            bHasDied?: (boolean|null);

            /** Player isOutsideBlueCircle */
            isOutsideBlueCircle?: (boolean|null);

            /** Player killNum */
            killNum?: (number|null);

            /** Player killNumBeforeDie */
            killNumBeforeDie?: (number|null);

            /** Player gotAirDropNum */
            gotAirDropNum?: (number|null);

            /** Player maxKillDistance */
            maxKillDistance?: (number|null);

            /** Player damage */
            damage?: (number|null);

            /** Player killNumInVehicle */
            killNumInVehicle?: (number|null);

            /** Player killNumByGrenade */
            killNumByGrenade?: (number|null);

            /** Player rank */
            rank?: (number|null);

            /** Player headShotNum */
            headShotNum?: (number|null);

            /** Player survivalTime */
            survivalTime?: (number|null);

            /** Player driveDistance */
            driveDistance?: (number|null);

            /** Player marchDistance */
            marchDistance?: (number|null);

            /** Player assists */
            assists?: (number|null);

            /** Player knockouts */
            knockouts?: (number|null);

            /** Player rescueTimes */
            rescueTimes?: (number|null);

            /** Player useSmokeGrenadeNum */
            useSmokeGrenadeNum?: (number|null);

            /** Player useFragGrenadeNum */
            useFragGrenadeNum?: (number|null);

            /** Player useBurnGrenadeNum */
            useBurnGrenadeNum?: (number|null);

            /** Player useFlashGrenadeNum */
            useFlashGrenadeNum?: (number|null);

            /** Player contribution */
            contribution?: (number|null);

            /** Player heal */
            heal?: (number|null);

            /** Player docId */
            docId?: (string|null);

            /** Unknown fields preserved while decoding when enabled */
            $unknowns?: Uint8Array[];
        }

        /** Shape of a Player. */
        type $Shape = overlay.Player.$Properties;
    }

    /**
     * Properties of a Team.
     * @deprecated Use overlay.Team.$Properties instead.
     */
    interface ITeam extends overlay.Team.$Properties {
    }

    /** Represents a Team. */
    class Team {

        /**
         * Constructs a new Team.
         * @param [properties] Properties to set
         */
        constructor(properties?: overlay.Team.$Properties);

        /** Unknown fields preserved while decoding when enabled */
        $unknowns?: Uint8Array[];

        /** Team teamId. */
        teamId: string;

        /** Team docId. */
        docId: string;

        /** Team teamName. */
        teamName?: (string|null);

        /** Team teamTag. */
        teamTag?: (string|null);

        /** Team teamLogo. */
        teamLogo?: (string|null);

        /** Team slot. */
        slot: number;

        /** Team placePoints. */
        placePoints: number;

        /** Team rank. */
        rank: number;

        /** Team wwcd. */
        wwcd: number;

        /** Team matchesPlayed. */
        matchesPlayed: number;

        /** Team players. */
        players: overlay.Player.$Properties[];

        /**
         * Creates a new Team instance using the specified properties.
         * @param [properties] Properties to set
         * @returns Team instance
         */
        static create(properties: overlay.Team.$Shape): overlay.Team & overlay.Team.$Shape;
        static create(properties?: overlay.Team.$Properties): overlay.Team;

        /**
         * Encodes the specified Team message. Does not implicitly {@link overlay.Team.verify|verify} messages.
         * @param message Team message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        static encode(message: overlay.Team.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified Team message, length delimited. Does not implicitly {@link overlay.Team.verify|verify} messages.
         * @param message Team message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        static encodeDelimited(message: overlay.Team.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a Team message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns {overlay.Team & overlay.Team.$Shape} Team
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): overlay.Team & overlay.Team.$Shape;

        /**
         * Decodes a Team message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns {overlay.Team & overlay.Team.$Shape} Team
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): overlay.Team & overlay.Team.$Shape;

        /**
         * Verifies a Team message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates a Team message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns Team
         */
        static fromObject(object: { [k: string]: any }): overlay.Team;

        /**
         * Creates a plain object from a Team message. Also converts values to other types if specified.
         * @param message Team
         * @param [options] Conversion options
         * @returns Plain object
         */
        static toObject(message: overlay.Team, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this Team to JSON.
         * @returns JSON object
         */
        toJSON(): { [k: string]: any };

        /**
         * Gets the type url for Team
         * @param [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
         * @returns The type url
         */
        static getTypeUrl(prefix?: string): string;
    }

    namespace Team {

        /** Properties of a Team. */
        interface $Properties {

            /** Team teamId */
            teamId?: (string|null);

            /** Team docId */
            docId?: (string|null);

            /** Team teamName */
            teamName?: (string|null);

            /** Team teamTag */
            teamTag?: (string|null);

            /** Team teamLogo */
            teamLogo?: (string|null);

            /** Team slot */
            slot?: (number|null);

            /** Team placePoints */
            placePoints?: (number|null);

            /** Team rank */
            rank?: (number|null);

            /** Team wwcd */
            wwcd?: (number|null);

            /** Team matchesPlayed */
            matchesPlayed?: (number|null);

            /** Team players */
            players?: (overlay.Player.$Properties[]|null);

            /** Unknown fields preserved while decoding when enabled */
            $unknowns?: Uint8Array[];
        }

        /** Shape of a Team. */
        type $Shape = overlay.Team.$Properties;
    }

    /**
     * Properties of a MatchDataPayload.
     * @deprecated Use overlay.MatchDataPayload.$Properties instead.
     */
    interface IMatchDataPayload extends overlay.MatchDataPayload.$Properties {
    }

    /** Represents a MatchDataPayload. */
    class MatchDataPayload {

        /**
         * Constructs a new MatchDataPayload.
         * @param [properties] Properties to set
         */
        constructor(properties?: overlay.MatchDataPayload.$Properties);

        /** Unknown fields preserved while decoding when enabled */
        $unknowns?: Uint8Array[];

        /** MatchDataPayload matchId. */
        matchId: string;

        /** MatchDataPayload teams. */
        teams: overlay.Team.$Properties[];

        /**
         * Creates a new MatchDataPayload instance using the specified properties.
         * @param [properties] Properties to set
         * @returns MatchDataPayload instance
         */
        static create(properties: overlay.MatchDataPayload.$Shape): overlay.MatchDataPayload & overlay.MatchDataPayload.$Shape;
        static create(properties?: overlay.MatchDataPayload.$Properties): overlay.MatchDataPayload;

        /**
         * Encodes the specified MatchDataPayload message. Does not implicitly {@link overlay.MatchDataPayload.verify|verify} messages.
         * @param message MatchDataPayload message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        static encode(message: overlay.MatchDataPayload.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified MatchDataPayload message, length delimited. Does not implicitly {@link overlay.MatchDataPayload.verify|verify} messages.
         * @param message MatchDataPayload message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        static encodeDelimited(message: overlay.MatchDataPayload.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a MatchDataPayload message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns {overlay.MatchDataPayload & overlay.MatchDataPayload.$Shape} MatchDataPayload
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): overlay.MatchDataPayload & overlay.MatchDataPayload.$Shape;

        /**
         * Decodes a MatchDataPayload message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns {overlay.MatchDataPayload & overlay.MatchDataPayload.$Shape} MatchDataPayload
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): overlay.MatchDataPayload & overlay.MatchDataPayload.$Shape;

        /**
         * Verifies a MatchDataPayload message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates a MatchDataPayload message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns MatchDataPayload
         */
        static fromObject(object: { [k: string]: any }): overlay.MatchDataPayload;

        /**
         * Creates a plain object from a MatchDataPayload message. Also converts values to other types if specified.
         * @param message MatchDataPayload
         * @param [options] Conversion options
         * @returns Plain object
         */
        static toObject(message: overlay.MatchDataPayload, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this MatchDataPayload to JSON.
         * @returns JSON object
         */
        toJSON(): { [k: string]: any };

        /**
         * Gets the type url for MatchDataPayload
         * @param [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
         * @returns The type url
         */
        static getTypeUrl(prefix?: string): string;
    }

    namespace MatchDataPayload {

        /** Properties of a MatchDataPayload. */
        interface $Properties {

            /** MatchDataPayload matchId */
            matchId?: (string|null);

            /** MatchDataPayload teams */
            teams?: (overlay.Team.$Properties[]|null);

            /** Unknown fields preserved while decoding when enabled */
            $unknowns?: Uint8Array[];
        }

        /** Shape of a MatchDataPayload. */
        type $Shape = overlay.MatchDataPayload.$Properties;
    }

    /**
     * Properties of an OverallDataPayload.
     * @deprecated Use overlay.OverallDataPayload.$Properties instead.
     */
    interface IOverallDataPayload extends overlay.OverallDataPayload.$Properties {
    }

    /** Represents an OverallDataPayload. */
    class OverallDataPayload {

        /**
         * Constructs a new OverallDataPayload.
         * @param [properties] Properties to set
         */
        constructor(properties?: overlay.OverallDataPayload.$Properties);

        /** Unknown fields preserved while decoding when enabled */
        $unknowns?: Uint8Array[];

        /** OverallDataPayload tournamentId. */
        tournamentId: string;

        /** OverallDataPayload roundId. */
        roundId: string;

        /** OverallDataPayload matchId. */
        matchId: string;

        /** OverallDataPayload teams. */
        teams: overlay.Team.$Properties[];

        /** OverallDataPayload createdAt. */
        createdAt: string;

        /**
         * Creates a new OverallDataPayload instance using the specified properties.
         * @param [properties] Properties to set
         * @returns OverallDataPayload instance
         */
        static create(properties: overlay.OverallDataPayload.$Shape): overlay.OverallDataPayload & overlay.OverallDataPayload.$Shape;
        static create(properties?: overlay.OverallDataPayload.$Properties): overlay.OverallDataPayload;

        /**
         * Encodes the specified OverallDataPayload message. Does not implicitly {@link overlay.OverallDataPayload.verify|verify} messages.
         * @param message OverallDataPayload message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        static encode(message: overlay.OverallDataPayload.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified OverallDataPayload message, length delimited. Does not implicitly {@link overlay.OverallDataPayload.verify|verify} messages.
         * @param message OverallDataPayload message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        static encodeDelimited(message: overlay.OverallDataPayload.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes an OverallDataPayload message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns {overlay.OverallDataPayload & overlay.OverallDataPayload.$Shape} OverallDataPayload
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): overlay.OverallDataPayload & overlay.OverallDataPayload.$Shape;

        /**
         * Decodes an OverallDataPayload message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns {overlay.OverallDataPayload & overlay.OverallDataPayload.$Shape} OverallDataPayload
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): overlay.OverallDataPayload & overlay.OverallDataPayload.$Shape;

        /**
         * Verifies an OverallDataPayload message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates an OverallDataPayload message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns OverallDataPayload
         */
        static fromObject(object: { [k: string]: any }): overlay.OverallDataPayload;

        /**
         * Creates a plain object from an OverallDataPayload message. Also converts values to other types if specified.
         * @param message OverallDataPayload
         * @param [options] Conversion options
         * @returns Plain object
         */
        static toObject(message: overlay.OverallDataPayload, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this OverallDataPayload to JSON.
         * @returns JSON object
         */
        toJSON(): { [k: string]: any };

        /**
         * Gets the type url for OverallDataPayload
         * @param [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
         * @returns The type url
         */
        static getTypeUrl(prefix?: string): string;
    }

    namespace OverallDataPayload {

        /** Properties of an OverallDataPayload. */
        interface $Properties {

            /** OverallDataPayload tournamentId */
            tournamentId?: (string|null);

            /** OverallDataPayload roundId */
            roundId?: (string|null);

            /** OverallDataPayload matchId */
            matchId?: (string|null);

            /** OverallDataPayload teams */
            teams?: (overlay.Team.$Properties[]|null);

            /** OverallDataPayload createdAt */
            createdAt?: (string|null);

            /** Unknown fields preserved while decoding when enabled */
            $unknowns?: Uint8Array[];
        }

        /** Shape of an OverallDataPayload. */
        type $Shape = overlay.OverallDataPayload.$Properties;
    }
}
