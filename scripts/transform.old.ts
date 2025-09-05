import ts, { factory } from "typescript";

function isExported(node: ts.Declaration): boolean {
	return (ts.getCombinedModifierFlags(node) & ts.ModifierFlags.Export) !== 0;
}

export function kind(node: ts.Node): string {
	return ts.SyntaxKind[node.kind];
}

function hasSingleTypeParameter(node: ts.FunctionDeclaration | ts.MethodDeclaration): ts.ParameterDeclaration|undefined {
    if (node.typeParameters && node.typeParameters.length == 1) {
		const typeParam = node.typeParameters[0];
		
		if (ts.isTypeParameterDeclaration(typeParam) && typeParam.constraint) {
			let param: ts.ParameterDeclaration | undefined;

			for (const p of node.parameters) {
				if (p.type && ts.isTypeReferenceNode(p.type) && p.type.typeName.getText() === typeParam.name.text) {
					if (param)
						return;
					param = p;
				}
			}

			return param;
		}
	}
}

function createParameters(node: ts.FunctionDeclaration | ts.MethodDeclaration, param: ts.ParameterDeclaration, member: ts.TypeNode) {
	return node.parameters.map(p => {
		if (p === param) {
			p = factory.createParameterDeclaration(
				undefined,	//modifiers
				undefined,	//dotDotDotToken
				param.name,	//name
				undefined,	//questionToken
				member,		//type
			);
			(p.type as any).parent = p;
		}
		return p;
	});
}

function resolveTypesTransformer(program: ts.Program): ts.TransformerFactory<ts.SourceFile> | undefined {
	console.log("Resolving Types");
	const typeChecker = program.getTypeChecker();

	function getMembersOfConstraintType(constraint: ts.TypeNode): ts.TypeNode[] {
		const type			= typeChecker.getTypeAtLocation(constraint);

		const declarations	= type.getSymbol()?.getDeclarations();
		if (declarations) {
			let declaration: ts.EnumDeclaration|undefined;
			for (const i of declarations) {
				if (ts.isEnumDeclaration(i)) {
					declaration = i;
					break;
				}
			}
			if (declaration) {
				const prefix = typeChecker.typeToString(type, declaration);
				return declaration.members.map(i => factory.createTypeReferenceNode(
					factory.createQualifiedName(factory.createIdentifier(prefix), i.name.getText()),
					undefined
				));
			}
		}

		if (type.isUnion()) {
			if (type.types.every(i => i.isNumberLiteral()))
				return type.types.map(i => factory.createLiteralTypeNode(factory.createNumericLiteral(i.value)));

			if (type.types.every(i => i.isStringLiteral()))
				return type.types.map(i => factory.createLiteralTypeNode(factory.createStringLiteral(i.value)));
		}
		return [];
	}

	return (context: ts.TransformationContext) => {
		return (sourceFile: ts.SourceFile) => {
			//TO DISABLE:
			//return sourceFile;

			let typeformatflags = ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope|ts.TypeFormatFlags.NoTruncation|ts.TypeFormatFlags.MultilineObjectLiterals;
			let exported 	= false;
			let depth		= 0;
			let declaration: ts.Declaration | undefined;
			const inherited: ts.ExpressionWithTypeArguments[] = [];
			
			// Create a cache for module resolution
			const moduleResolutionCache = ts.createModuleResolutionCache(
				process.cwd(), 			// Current working directory
				fileName => fileName	// Normalize file names
			);

			const moduleMap: Record<string, string> = {};

			function serializeNode(node: ts.Node): string {
				const printer = ts.createPrinter();
				const result = printer.printNode(ts.EmitHint.Unspecified, node, sourceFile);
				return result;
			}

			function print(x: string) {
				console.log('  '.repeat(depth), x);
			}

			function fixParents(node: ts.Node) {
				let	parent = node;
				function visit(node: ts.Node): ts.Node {
					const save = parent;
					parent = node;
					node = ts.visitEachChild(node, visit, context);
					(node as any).parent = parent = save;
					return node;
				}
				return ts.visitEachChild(node, visit, context);
			}
			function templateSubstitute(node: ts.Node, param: string, replacement: ts.TypeNode) {
				function visit(node: ts.Node): ts.Node {
					if (ts.isTypeReferenceNode(node)) {
						// If the type node is a reference to the type parameter, replace it
						if (ts.isIdentifier(node.typeName) && node.typeName.text === param)
							return replacement;
					}
					return ts.visitEachChild(node, visit, context);
				}
				return ts.visitNode(node, visit);
			}
			
			function createReturn(node: ts.FunctionDeclaration | ts.MethodDeclaration, member: ts.TypeNode) {
				const ret = fixParents(templateSubstitute(node.type!, node.typeParameters![0].name.getText(), member));
				const obj = ret as any;
				//(ret as any).original = undefined;
				obj.flags &= ~16;
				obj.parent = obj.original.parent;
				return ret as ts.TypeNode;
			}
			

			//various type fixing
			function visitSubType(node: ts.Node): ts.Node {
				//print(kind(node));

				if (ts.isQualifiedName(node))
					return node;

				// add module prefix if missing
				if (ts.isIdentifier(node)) {
					const symbol = (node as any).symbol;
					if (symbol) {
						const declarations = symbol.getDeclarations();
						if (declarations && declarations.length > 0) {
							const prefix = moduleMap[declarations[0].getSourceFile().fileName];
							if (prefix)
								return factory.createQualifiedName(factory.createIdentifier(prefix), node.text);
						}
					}
				}
		
				++depth;
				node = ts.visitEachChild(node, visitSubType, context);
				--depth;

				// strip {}'s from intersection
				if (ts.isIntersectionTypeNode(node)) {
					const filtered = node.types.filter(n => !ts.isTypeLiteralNode(n) || n.members.length);
					if (filtered.length === 1)
						return filtered[0];
					return ts.factory.updateIntersectionTypeNode(node, ts.factory.createNodeArray(filtered));
		  		}

				// remove parentheses if not needed
				if (ts.isParenthesizedTypeNode(node)) {
					if (ts.isTypeLiteralNode(node.type))
						return node.type;
				}

				return node;
			}
			
			//finds types
			function visitType(node: ts.Node): ts.Node | undefined {
				if (ts.isTypeNode(node)) {
					const type		= typeChecker.getTypeAtLocation(node);
					const typetext	= typeChecker.typeToString(type, declaration);
					//print('"'+typetext+'"');

					let node1 = typetext === 'any' ? node : typeChecker.typeToTypeNode(type, declaration, typeformatflags);

					if (node1 && !ts.isTypeReferenceNode(node1)) {
						node1 = visitSubType(node1) as ts.TypeNode;
						const text2 = serializeNode(node1);
						//console.log("**AFTER**" + text2);
						if (text2 !== 'any')
							return node1;
					}

					return node;
				}
				return ts.visitEachChild(node, visitType, context);
			}

			function fixTypes(node: ts.Declaration) {
				const save = declaration;
				declaration = node;
				//fixParents(node);
				node = ts.visitEachChild(node, visitType, context);
				declaration = save;
				return node;
			}

			//	VISIT
			function visit(node: ts.Node): ts.Node | undefined {
				//print(kind(node));

				if (ts.isVariableDeclaration(node)) {
					if (isExported(node)) {
						exported = true;
						return node;
					}
					for (const i of inherited) {
						if (i.expression === node.name) {
							declaration	= node;
							exported	= true;
							//return node;
							return fixTypes(node);
						}
					}
					return undefined; // Remove the node
				}

				if (ts.isVariableStatement(node)) {
					const modifiers = node.modifiers;
					exported	= !!modifiers && modifiers.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword);
					if (!exported)
						node = ts.visitEachChild(node, visit, context);
					return exported ? node : undefined;
				}

				if (ts.isTypeAliasDeclaration(node)) {
					declaration = node;
					//print("++TYPEDEF");
					const save = typeformatflags;
					typeformatflags = (typeformatflags & ~ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope) | ts.TypeFormatFlags.InTypeAlias | ts.TypeFormatFlags.MultilineObjectLiterals;
					node = fixTypes(node);
					typeformatflags = save;
					//print("--TYPEDEF");
					return node;
				}

				if (ts.isClassDeclaration(node)) {
					const newMembers: ts.ClassElement[] = [];
					let update = false;
					for (const member of node.members) {
						const param = ts.isMethodDeclaration(member) && hasSingleTypeParameter(member);
						if (param) {
							update	= true;
							const members		= getMembersOfConstraintType(member.typeParameters![0].constraint!);
							const overloads 	= members.map(i => factory.createMethodDeclaration(
								undefined,		// modifiers
								undefined,		// asteriskToken
								member.name,	// name
								undefined,		// questionToken
								undefined,		// typeParameters
								createParameters(member, param, i),	// parameters
								createReturn(member, i),	//type
								undefined		//body
							));
							// Add the overloads to the class members
							newMembers.push(...overloads);
						} else {
							// Add the original member to the class
							newMembers.push(member);
						}
					}
					if (update) {
						// Update the class declaration with the new members
						node = factory.updateClassDeclaration(
							node,
							node.modifiers,
							node.name,
							node.typeParameters,
							node.heritageClauses,
							newMembers
						);
					}
				}

				if (ts.isMethodDeclaration(node))
					return fixTypes(node);

				if (ts.isPropertyDeclaration(node))
					return fixTypes(node);

				if (ts.isFunctionDeclaration(node))
					return fixTypes(node);

				++depth;
				node = ts.visitEachChild(node, visit, context);
				--depth;
				return node;
				//return ts.visitEachChild(node, visit, context);
			}
			
			//SourceFile:
			const newStatements: ts.Statement[] = [];

			for (const statement of sourceFile.statements) {
				//check for inheriting consts
				if (ts.isClassDeclaration(statement)) {
					const heritageClauses = statement.heritageClauses;
					if (heritageClauses) {
						for (const i of heritageClauses) {
							if (i.token === ts.SyntaxKind.ExtendsKeyword)
								inherited.push(...i.types);
						}
					}

				} else if (ts.isImportDeclaration(statement)) {
					const importClause = statement.importClause;
					if (importClause && importClause.namedBindings && ts.isNamespaceImport(importClause.namedBindings)) {
						const module = statement.moduleSpecifier;
						if (ts.isStringLiteral(module)) {
							// Resolve the module name to its file path
							const resolved = ts.resolveModuleName(
								module.text,
								sourceFile.fileName,
								program.getCompilerOptions(),
								{
									fileExists: ts.sys.fileExists, // File system methods
									readFile: ts.sys.readFile,
								},
								moduleResolutionCache
							);
			
							if (resolved.resolvedModule)
								moduleMap[resolved.resolvedModule.resolvedFileName] = importClause.namedBindings.name.text;
						}
					}

				} else if (ts.isFunctionDeclaration(statement)) {
					const param = hasSingleTypeParameter(statement);
					if (param) {
						console.log("hi");
						const members		= getMembersOfConstraintType(statement.typeParameters![0].constraint!);
						const overloads 	= members.map(i => factory.createFunctionDeclaration(
							[factory.createModifier(ts.SyntaxKind.ExportKeyword)], // Add export
							undefined,		//asteriskToken
							statement.name,	//name
							undefined,		//type params
							createParameters(statement, param, i),
							createReturn(statement, i),	//type
							undefined		//body
						));
						newStatements.push(...overloads);
						continue;
					}
				}

				newStatements.push(statement);
			}
			return ts.visitEachChild(factory.updateSourceFile(sourceFile, newStatements), visit, context);
		};
	};
}

export default resolveTypesTransformer;